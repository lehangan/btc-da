require('dotenv').config();
const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');

// Cấu hình ECPair
const ECPair = ECPairFactory(ecc);
const NETWORK = bitcoin.networks.testnet;

// 1. Lấy và Xử lý Key từ .env
const RAW_KEY = process.env.BTC_PRIVATE_KEY ? process.env.BTC_PRIVATE_KEY.trim() : "";
const STRATA_RPC = process.env.STRATA_RPC || "http://131.153.224.169:26757";

if (!RAW_KEY) {
    console.error("❌ LỖI: Chưa cấu hình BTC_PRIVATE_KEY trong file .env");
    process.exit(1);
}

// 2. Tự động nhận diện định dạng Key
let keyPair;
try {
    keyPair = ECPair.fromWIF(RAW_KEY, NETWORK);
    console.log("🔑 Phát hiện định dạng key: WIF");
} catch (e) {
    try {
        const buffer = Buffer.from(RAW_KEY, 'hex');
        if (buffer.length !== 32) throw new Error("Hex key phải dài 32 bytes");
        keyPair = ECPair.fromPrivateKey(buffer, { network: NETWORK });
        console.log("🔑 Phát hiện định dạng key: HEX");
    } catch (err) {
        console.error("❌ LỖI KEY: Key không hợp lệ.");
        process.exit(1);
    }
}

// Tạo địa chỉ Native Segwit
const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK });

console.log(`🤖 STRATA ANCHOR BOT (NODE.JS - BIGINT FIX)`);
console.log(`👉 VÍ ĐANG CHẠY: ${address}`);

// --- CÁC HÀM HỖ TRỢ ---

async function getStrataBlock() {
    try {
        const res = await axios.get(`${STRATA_RPC}/status`);
        const info = res.data.result.sync_info;
        return {
            height: parseInt(info.latest_block_height),
            hash: info.latest_block_hash
        };
    } catch (e) {
        return null;
    }
}

async function getUTXOs(addr) {
    try {
        const res = await axios.get(`https://mempool.space/testnet/api/address/${addr}/utxo`);
        return res.data;
    } catch (e) {
        return [];
    }
}

async function broadcastTx(hex) {
    try {
        const res = await axios.post('https://mempool.space/testnet/api/tx', hex);
        return res.data;
    } catch (e) {
        throw new Error(e.response ? e.response.data : e.message);
    }
}

async function anchorToBitcoin(height, blockHash) {
    console.log(`\n[🔄 PROCESS] Đang xử lý Block ${height}...`);

    const utxos = await getUTXOs(address);
    if (!utxos || utxos.length === 0) {
        console.log(`   ❌ VÍ RỖNG! Vui lòng nạp tBTC vào: ${address}`);
        return false;
    }

    // Tính tổng tiền
    let totalBalance = 0;
    utxos.forEach(u => totalBalance += u.value);
    console.log(`   💰 Số dư khả dụng: ${totalBalance} sats`);

    if (totalBalance < 2000) {
        console.log(`   ⏳ Số dư yếu, chờ nạp thêm...`);
        return false;
    }

    const memo = `STRATA:${height}:${blockHash}`;
    const embed = bitcoin.payments.embed({ data: [Buffer.from(memo, 'utf8')] });
    
    const psbt = new bitcoin.Psbt({ network: NETWORK });

    // --- BƯỚC THÊM INPUT (QUAN TRỌNG: DÙNG BIGINT) ---
    for (const u of utxos) {
        psbt.addInput({
            hash: u.txid,
            index: u.vout,
            witnessUtxo: {
                script: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).output,
                value: BigInt(u.value), // <--- FIX: Ép kiểu sang BigInt
            },
        });
    }

    // --- BƯỚC THÊM OUTPUT (QUAN TRỌNG: DÙNG BIGINT) ---
    // Output 1: OP_RETURN (Giá trị 0)
    psbt.addOutput({ 
        script: embed.output, 
        value: BigInt(0) // <--- FIX: Số 0 cũng phải là BigInt
    });

    const fee = 1000;
    const change = totalBalance - fee;

    // Output 2: Tiền thừa về ví
    if (change > 546) {
        psbt.addOutput({ 
            address: address, 
            value: BigInt(change) // <--- FIX: Ép kiểu sang BigInt
        });
    }

    // Ký và Gửi
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    
    const txHex = psbt.extractTransaction().toHex();
    console.log(`   📡 Đang gửi lên mạng Bitcoin...`);

    try {
        const txid = await broadcastTx(txHex);
        console.log(`   └─ 🚀 GỬI THÀNH CÔNG!`);
        console.log(`✅ [${new Date().toLocaleTimeString()}] ANCHOR CONFIRMED`);
        console.log(`💎 TxID : ${txid}`);
        console.log(`🧱 Height: ${height}`);
        console.log(`============================================================`);
        return true;
    } catch (e) {
        console.log(`   ❌ Lỗi Broadcast: ${e.message}`);
        return false;
    }
}

async function main() {
    let lastHeight = 0;
    while (true) {
        const block = await getStrataBlock();
        if (block && block.height > lastHeight + 10) {
            console.log(`\n📦 Block Strata mới: ${block.height} `);
            const success = await anchorToBitcoin(block.height, block.hash);
            if (success) lastHeight = block.height;
        } else {
            process.stdout.write(".");
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

main();