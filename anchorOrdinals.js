require('dotenv').config();
const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const { MerkleTree } = require('merkletreejs');
const SHA256 = require('crypto-js/sha256');

// --- CẤU HÌNH ---
const ECPair = ECPairFactory(ecc);
const NETWORK = bitcoin.networks.testnet; 
const STRATA_RPC = process.env.STRATA_RPC || "http://131.153.224.169:26757";
const BATCH_SIZE = 5; 

// --- KHỞI TẠO VÍ CHÍNH ---
const RAW_KEY = process.env.BTC_PRIVATE_KEY ? process.env.BTC_PRIVATE_KEY.trim() : "";
if (!RAW_KEY) { console.error("❌ LỖI: Thiếu BTC_PRIVATE_KEY"); process.exit(1); }

let mainKeyPair;
try {
    mainKeyPair = ECPair.fromWIF(RAW_KEY, NETWORK);
} catch (e) {
    const buffer = Buffer.from(RAW_KEY, 'hex');
    mainKeyPair = ECPair.fromPrivateKey(buffer, { network: NETWORK });
}
const { address: mainAddress } = bitcoin.payments.p2wpkh({ pubkey: mainKeyPair.publicKey, network: NETWORK });

console.log(`🤖 STRATA ORDINALS BOT`);
console.log(`👉 VÍ CHÍNH (Funding): ${mainAddress}`);
console.log(`=========================================`);

bitcoin.initEccLib(ecc); // BẮT BUỘC

async function getStrataBlock() {
    try {
        const res = await axios.get(`${STRATA_RPC}/status`);
        return {
            height: parseInt(res.data.result.sync_info.latest_block_height),
            hash: res.data.result.sync_info.latest_block_hash
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
    } catch (e) { 
        throw new Error(e.response ? JSON.stringify(e.response.data) : e.message); 
    }
}

// 🔥 FIX 1: Dùng Opcodes chuẩn để tránh lỗi "Unknown script error"
function createInscriptionScript(xOnlyPubkey, dataString) {
    const content = Buffer.from(dataString, 'utf8');
    const contentType = Buffer.from('text/plain;charset=utf-8', 'utf8');
    
    return bitcoin.script.compile([
        xOnlyPubkey,
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_0,
        bitcoin.opcodes.OP_IF,
        Buffer.from("ord", "utf8"),
        bitcoin.opcodes.OP_1, // Thay số 1 bằng OP_1
        contentType,
        bitcoin.opcodes.OP_0, // Thay số 0 bằng OP_0
        content,
        bitcoin.opcodes.OP_ENDIF
    ]);
}

// --- HÀM CHÍNH ---
async function anchorBatchOrdinal(batch) {
    const startHeight = batch[0].height;
    const endHeight = batch[batch.length - 1].height;
    
    // 1. TÍNH MERKLE ROOT
    const leaves = batch.map(b => SHA256(b.hash));
    const tree = new MerkleTree(leaves, SHA256);
    const root = tree.getRoot().toString('hex');
    const memo = `STRATA:${startHeight}:${endHeight}:${root}`;

    console.log(`\n📦 BATCH ${startHeight}-${endHeight} | ROOT: ${root}`);

    // 2. TẠO VÍ CAM KẾT
    const tempKeyPair = ECPair.makeRandom({ network: NETWORK });
    const internalPubkey = tempKeyPair.publicKey.subarray(1, 33); // 32 bytes X-Only
    
    const leafScript = createInscriptionScript(internalPubkey, memo);

    // Kiểm tra script hợp lệ ngay lập tức
    try {
        bitcoin.script.decompile(leafScript);
    } catch(e) {
        console.error("❌ Lỗi Script Decompile:", e);
        return false;
    }
    
    const scriptTree = { output: leafScript };
    const p2tr = bitcoin.payments.p2tr({
        internalPubkey,
        scriptTree,
        redeem: scriptTree,
        network: NETWORK
    });

    console.log(`   🔐 Ví Commit: ${p2tr.address}`);

    // 3. COMMIT TX
    const REVEAL_AMOUNT = 3000;
    const utxos = await getUTXOs(mainAddress);
    if (!utxos.length) { console.log("❌ Hết tiền!"); return false; }
    
    const psbtCommit = new bitcoin.Psbt({ network: NETWORK });
    let totalIn = 0;
    
    for (const u of utxos) {
        psbtCommit.addInput({
            hash: u.txid, index: u.vout,
            witnessUtxo: { 
                script: bitcoin.payments.p2wpkh({ pubkey: mainKeyPair.publicKey, network: NETWORK }).output, 
                value: BigInt(u.value) 
            }
        });
        totalIn += u.value;
        if (totalIn > REVEAL_AMOUNT + 2000) break;
    }

    psbtCommit.addOutput({ address: p2tr.address, value: BigInt(REVEAL_AMOUNT) });
    const change = totalIn - REVEAL_AMOUNT - 1500;
    if (change > 546) psbtCommit.addOutput({ address: mainAddress, value: BigInt(change) });

    psbtCommit.signAllInputs(mainKeyPair);
    psbtCommit.finalizeAllInputs();
    const txCommit = psbtCommit.extractTransaction();
    const txCommitId = txCommit.getId();

    console.log(`   🚀 Broadcasting COMMIT... (${txCommitId})`);
    try { await broadcastTx(txCommit.toHex()); } catch (e) { console.log(`❌ Lỗi Commit: ${e.message}`); return false; }

    console.log("   ⏳ Đợi 5 giây...");
    await new Promise(r => setTimeout(r, 5000));

    // 4. REVEAL TX
    const psbtReveal = new bitcoin.Psbt({ network: NETWORK });
    
    psbtReveal.addInput({
        hash: txCommitId,
        index: 0,
        witnessUtxo: { value: BigInt(REVEAL_AMOUNT), script: p2tr.output },
        tapLeafScript: [{
            leafVersion: 192,
            script: leafScript,
            controlBlock: p2tr.witness[p2tr.witness.length - 1]
        }]
    });

    const changeReveal = REVEAL_AMOUNT - 1500; 
    psbtReveal.addOutput({ address: mainAddress, value: BigInt(changeReveal) });

    // 🔥 FIX 2: Giữ nguyên Schnorr Signer
    const tweakedSigner = {
        publicKey: internalPubkey,
        signSchnorr: (hash) => tempKeyPair.signSchnorr(hash)
    };

    psbtReveal.signInput(0, tweakedSigner);
    psbtReveal.finalizeAllInputs();
    
    console.log(`   🚀 Broadcasting REVEAL...`);
    try {
        const txRevealId = await broadcastTx(psbtReveal.extractTransaction().toHex());
        
        console.log(`   ✅ DONE! TxID: https://mempool.space/testnet/tx/${txRevealId}`);
        return true;
    } catch (e) {
        console.log(`❌ Lỗi Reveal: ${e.message}`);
        return false;
    }
}

// --- MAIN LOOP ---
async function main() {
    let lastProcessedHeight = 0;
    let batchBuffer = [];

    while (true) {
        const block = await getStrataBlock();
        if (block && block.height > lastProcessedHeight) {
            if (batchBuffer.length > 0 && batchBuffer[batchBuffer.length-1].height === block.height) {} 
            else {
                batchBuffer.push(block);
                console.log(`📥 Gom Block ${block.height} (${batchBuffer.length}/${BATCH_SIZE})`);
                lastProcessedHeight = block.height;
                if (batchBuffer.length >= BATCH_SIZE) {
                    const success = await anchorBatchOrdinal(batchBuffer);
                    if (success) batchBuffer = [];
                }
            }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}
main();