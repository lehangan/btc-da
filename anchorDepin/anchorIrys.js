require('dotenv').config();
const axios = require('axios');
const Irys = require("@irys/sdk");
const fs = require('fs');

// --- CẤU HÌNH ---
const DAL_RPC = process.env.DAL_RPC;
const IRYS_NODE = "https://devnet.irys.xyz"; 
const TOKEN_CURRENCY = "ethereum";           
const PROVIDER_URL = "https://1rpc.io/sepolia"; 

const STATE_FILE = './state.json'; 
const HISTORY_JSON = './anchorDepin/archiver.json';

// --- HÀM 1: KẾT NỐI IRYS ---
async function getIrys() {
    const irys = new Irys({
        url: IRYS_NODE,
        token: TOKEN_CURRENCY,
        key: process.env.PRIVATE_KEY,
        config: { providerUrl: PROVIDER_URL }
    });
    return irys;
}

// --- HÀM 2: GIẢI MÃ DỮ LIỆU DEPIN TỪ TXS ---
function decodeDePINData(txBase64) {
    try {
        const decodedString = Buffer.from(txBase64, 'base64').toString('utf-8');
        const jsonMatch = decodedString.match(/\{".*"\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]); // Trả về object JSON luôn
        return null;
    } catch (e) {
        return null;
    }
}

// --- HÀM 3: GHI LỊCH SỬ VÀO FILE JSON ---
function appendToJSONHistory(entry) {
    let history = [];
    try {
        if (fs.existsSync(HISTORY_JSON)) {
            const fileContent = fs.readFileSync(HISTORY_JSON, 'utf-8');
            history = JSON.parse(fileContent);
        }
    } catch (e) {
        console.error("⚠️ Lỗi đọc file history JSON, khởi tạo mới...");
    }

    history.push({
        timestamp: new Date().toISOString(),
        ...entry
    });

    // Lưu lại với định dạng dễ đọc (indent 2)
    fs.writeFileSync(HISTORY_JSON, JSON.stringify(history, null, 2));
}

// --- HÀM 4: LẤY BLOCK TỪ DAL ---
async function fetchBlock(height) {
    try {
        const url = `${DAL_RPC}/block?height=${height}`;
        const res = await axios.get(url);
        if (res.data && res.data.result && res.data.result.block) return res.data.result; 
        return null;
    } catch (e) { return null; }
}

// --- HÀM 5: QUẢN LÝ TIẾN ĐỘ ---
function getLastHeight() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE)).lastHeight;
    }
    return 1;
}

function saveHeight(height) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastHeight: height }));
}

// --- MAIN LOOP ---
async function main() {
    console.log("🚀 STARTING JSON ARCHIVER & DECODER...");
    const irys = await getIrys();
    let currentHeight = getLastHeight();

    while (true) {
        const blockData = await fetchBlock(currentHeight);

        if (blockData) {
            const blockHash = blockData.block_id.hash;
            const txs = blockData.block.data.txs || [];
            
            try {
                // 1. Decode dữ liệu
                const decodedPayloads = txs.map(tx => decodeDePINData(tx)).filter(d => d !== null);

                // 2. Data nộp lên Irys
                const payload = {
                    chain: "engram",
                    height: currentHeight,
                    block_hash: blockHash,
                    block_data: blockData,
                    depin_records: decodedPayloads
                };

                // 3. Upload
                const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
                const price = await irys.getPrice(size);
                const balance = await irys.getLoadedBalance();

                if (balance.lt(price)) await irys.fund(price); 
                
                const receipt = await irys.upload(JSON.stringify(payload), {
                    tags: [
                        { name: "Content-Type", value: "application/json" },
                        { name: "Block-Height", value: currentHeight.toString() }
                    ]
                });

                console.log(`✅ Block #${currentHeight} archived. ID: ${receipt.id}`);
                
                // 4. Ghi lịch sử vào JSON
                appendToJSONHistory({
                    height: currentHeight,
                    block_hash: blockHash,
                    irys_id: receipt.id,
                    gateway_url: `https://gateway.irys.xyz/${receipt.id}`,
                    tx_count: txs.length,
                    depin_data: decodedPayloads
                });
                
                saveHeight(currentHeight);
                currentHeight++;

            } catch (err) {
                console.error(`❌ Error at #${currentHeight}: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
            }
        } else {
            process.stdout.write(`\r⏳ Waiting for Block #${currentHeight}...`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

main();