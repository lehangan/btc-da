require('dotenv').config();
const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');

// --- THƯ VIỆN MỚI ĐỂ TẠO MERKLE ROOT ---
const { MerkleTree } = require('merkletreejs');
const SHA256 = require('crypto-js/sha256');

// Cấu hình
const ECPair = ECPairFactory(ecc);
const NETWORK = bitcoin.networks.testnet;
const STRATA_RPC = process.env.STRATA_RPC || "http://131.153.224.169:26757";
const BATCH_SIZE = 5; // Gom 5 block rồi mới gửi 1 lần (Thực tế có thể để 100)

// ... (Đoạn code xử lý Key và tìm ví giữ nguyên như cũ) ...
const RAW_KEY = process.env.BTC_PRIVATE_KEY ? process.env.BTC_PRIVATE_KEY.trim() : "";
if (!RAW_KEY) { console.error("❌ LỖI: Thiếu Key"); process.exit(1); }

let keyPair;
try {
    keyPair = ECPair.fromWIF(RAW_KEY, NETWORK);
} catch (e) {
    const buffer = Buffer.from(RAW_KEY, 'hex');
    keyPair = ECPair.fromPrivateKey(buffer, { network: NETWORK });
}
const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK });
console.log(`🤖 STRATA BATCHER BOT (MERKLE ROOT MODE)`);
console.log(`👉 VÍ: ${address} | BATCH SIZE: ${BATCH_SIZE}`);

// ... (Giữ nguyên các hàm getUTXOs, getStrataBlock, broadcastTx) ...
// (Để cho gọn tôi không paste lại các hàm phụ trợ, bạn giữ nguyên nhé)
async function getStrataBlock() {
    try {
        const res = await axios.get(`${STRATA_RPC}/status`);
        const info = res.data.result.sync_info;
        return {
            height: parseInt(info.latest_block_height),
            hash: info.latest_block_hash
        };
    } catch (e) { return null; }
}
async function getUTXOs(addr) {
    try {
        const res = await axios.get(`https://mempool.space/testnet/api/address/${addr}/utxo`);
        return res.data;
    } catch (e) { return []; }
}
async function broadcastTx(hex) {
    try {
        const res = await axios.post('https://mempool.space/testnet/api/tx', hex);
        return res.data;
    } catch (e) { throw new Error(e.response ? e.response.data : e.message); }
}

// --- HÀM NEO ĐẬU BATCH ---
async function anchorBatch(batch) {
    const startHeight = batch[0].height;
    const endHeight = batch[batch.length - 1].height;
    
    console.log(`\n[🌳 MERKLE] Đang tạo Merkle Tree cho Block ${startHeight} -> ${endHeight}...`);

    // 1. Tạo lá (Leaves) từ Hash của các block
    const leaves = batch.map(b => SHA256(b.hash));
    
    // 2. Tạo cây Merkle
    const tree = new MerkleTree(leaves, SHA256);
    
    // 3. Lấy Root (Dạng Hex)
    const root = tree.getRoot().toString('hex');
    
    console.log(`   🍃 Số lá: ${leaves.length}`);
    console.log(`   🌳 Merkle Root: ${root}`);

    // 4. Tạo dữ liệu OP_RETURN: "STRATA:Start:End:Root"
    const memo = `STRATA:${startHeight}:${endHeight}:${root}`;
    console.log(`   📦 Payload: ${memo}`);

    // --- GỬI LÊN BITCOIN (Giống code cũ) ---
    const utxos = await getUTXOs(address);
    if (!utxos.length) return false;
    
    let totalBalance = utxos.reduce((a, b) => a + b.value, 0);
    const embed = bitcoin.payments.embed({ data: [Buffer.from(memo, 'utf8')] });
    const psbt = new bitcoin.Psbt({ network: NETWORK });

    for (const u of utxos) {
        psbt.addInput({
            hash: u.txid, index: u.vout,
            witnessUtxo: { script: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).output, value: BigInt(u.value) }
        });
    }

    psbt.addOutput({ script: embed.output, value: BigInt(0) }); // OP_RETURN
    
    const fee = 1000;
    const change = totalBalance - fee;
    if (change > 546) {
        psbt.addOutput({ address: address, value: BigInt(change) });
    }

    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    try {
        const txid = await broadcastTx(psbt.extractTransaction().toHex());
        console.log(`   🚀 BATCH ANCHORED! TxID: ${txid}`);
        console.log(`================================================`);
        return true;
    } catch (e) {
        console.log(`❌ Lỗi gửi: ${e.message}`);
        return false;
    }
}

// --- MAIN LOOP ---
async function main() {
    let lastProcessedHeight = 0;
    let batchBuffer = []; // Mảng chứa các block đang gom

    while (true) {
        const block = await getStrataBlock();
        
        // Chỉ xử lý block mới
        if (block && block.height > lastProcessedHeight) {
            
            // Thêm block vào mảng gom
            batchBuffer.push(block);
            console.log(`📥 Gom Block ${block.height} hash ${block.hash} (Buffer: ${batchBuffer.length}/${BATCH_SIZE})`);
            lastProcessedHeight = block.height;

            // Nếu gom đủ số lượng -> Gửi đi
            if (batchBuffer.length >= BATCH_SIZE) {
                const success = await anchorBatch(batchBuffer);
                if (success) {
                    batchBuffer = []; // Reset bộ đệm
                } else {
                    console.log("⚠️ Gửi thất bại, giữ lại buffer để thử lại...");
                }
            }
        }
        
        await new Promise(r => setTimeout(r, 2000)); // Check nhanh hơn (2s)
    }
}

main();