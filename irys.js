require('dotenv').config();
const axios = require('axios');
const Irys = require("@irys/sdk");
const fs = require('fs');

// --- CẤU HÌNH ---
const DAL_RPC = process.env.DAL_RPC;
const IRYS_NODE = "https://devnet.irys.xyz"; // Node Devnet (Miễn phí test)
const TOKEN_CURRENCY = "ethereum";           // Dùng mạng Ethereum
const PROVIDER_URL = "https://1rpc.io/sepolia"; // RPC Sepolia Testnet

// File lưu trạng thái (để nhớ đã backup đến block nào)
const STATE_FILE = './state.json'; 

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

// --- HÀM 2: LẤY BLOCK TỪ DAL LOCAL ---
async function fetchBlock(height) {
    try {
        // Gọi RPC lấy block (Celestia/Tendermint format)
        const url = `${DAL_RPC}/block?height=${height}`;
        const res = await axios.get(url);
        
        // Kiểm tra xem block có hợp lệ không
        if (res.data && res.data.result && res.data.result.block) {
            return res.data.result; 
        }
        return null;
    } catch (e) {
        // Nếu lỗi 404 hoặc mạng -> Có thể block chưa sinh ra
        return null; 
    }
}

// --- HÀM 3: LẤY TIẾN ĐỘ CŨ ---
function getLastHeight() {
    if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE);
        return JSON.parse(data).lastHeight;
    }
    return 1; // Mặc định chạy từ block 1 nếu chưa có file save
}

// --- HÀM 4: LƯU TIẾN ĐỘ MỚI ---
function saveHeight(height) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastHeight: height }));
}

// ... (Các phần khai báo ở trên giữ nguyên)

// --- MAIN LOOP ĐÃ FIX LỖI ---
async function main() {
    console.log("🚀 KHỞI ĐỘNG STRATA ARCHIVER (IRYS VERSION)...");
    
    // 1. Kết nối & Check tiền
    const irys = await getIrys();
    console.log(`   - Ví Archiver: ${irys.address}`);
    
    // Hiển thị số dư ban đầu (Dùng fromAtomic để đổi sang ETH)
    const initBalance = await irys.getLoadedBalance();
    console.log(`   - Số dư: ${irys.utils.fromAtomic(initBalance)} ETH (Sepolia)`);

    let currentHeight = getLastHeight();
    console.log(`   - Bắt đầu từ Block: #${currentHeight}`);

    while (true) {
        // 2. Lấy dữ liệu Block
        const blockData = await fetchBlock(currentHeight);

        if (blockData) {
            const blockHash = blockData.block_id.hash;
            console.log(`📦 Đang xử lý Block #${currentHeight} | Hash: ${blockHash.slice(0, 8)}...`);

            try {
                // 3. Chuẩn bị Payload
                const dataToUpload = JSON.stringify({
                    chain: "engram",
                    height: currentHeight,
                    data: blockData
                });

                // 4. Tính toán phí & Nạp tiền tự động
                const size = Buffer.byteLength(dataToUpload, 'utf8');
                const price = await irys.getPrice(size);
                const balance = await irys.getLoadedBalance();

                // Log giá tiền (Dùng fromAtomic để không bị lỗi)
                // console.log(`   - Phí upload: ${irys.utils.fromAtomic(price)} ETH`);

                // Nếu số dư < giá upload -> Nạp thêm tiền từ Sepolia
                if (balance.lt(price)) {
                    console.log(`   ⚠️ Số dư thấp (${irys.utils.fromAtomic(balance)} ETH). Cần: ${irys.utils.fromAtomic(price)} ETH`);
                    console.log(`   🔄 Đang nạp thêm tiền từ ví Sepolia...`);
                    
                    try {
                         // Nạp tiền
                         await irys.fund(price); 
                         console.log(`   ✅ Đã nạp xong!`);
                    } catch (fundErr) {
                        console.error(`   ❌ Lỗi nạp tiền: ${fundErr.message}`);
                        // Nếu lỗi nạp tiền thì dừng lại kiểm tra, không upload liều
                        await new Promise(r => setTimeout(r, 5000));
                        continue; 
                    }
                }
                
                console.log(`   - Upload dữ liệu Block #${currentHeight} với kích thước ${size} bytes`);
                console.log(dataToUpload);
                // 5. Upload lên Irys
                const receipt = await irys.upload(dataToUpload, {
                    tags: [
                        { name: "App-Name", value: "Strata-Local-Archiver" },
                        { name: "Content-Type", value: "application/json" },
                        { name: "Block-Height", value: currentHeight.toString() }
                    ]
                });

                console.log(`   ✅ Upload thành công!`);
                console.log(`   👉 ID: https://gateway.irys.xyz/${receipt.id}`);
                
                // 6. Lưu tiến độ & Tăng height
                saveHeight(currentHeight);
                currentHeight++;

            } catch (err) {
                // In lỗi chi tiết hơn
                console.error(`   ❌ Lỗi Upload Block ${currentHeight}:`);
                console.error(`      ${err.message}`);
                await new Promise(r => setTimeout(r, 2000)); // Nghỉ 2s rồi thử lại
            }

        } else {
            // Nếu chưa có block mới, chờ 3s
            console.log(`⏳ Đang chờ Block #${currentHeight}...`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

main();