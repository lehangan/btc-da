require('dotenv').config();
const axios = require('axios');
// Thư viện Merkle Tree
const { MerkleTree } = require('merkletreejs');
const SHA256 = require('crypto-js/sha256');

// Thư viện Babylon (Cosmos SDK) - Giả lập hoặc dùng thật
// Nếu chưa cài thư viện, bạn có thể comment phần này lại để test logic Merkle trước
// const { DirectSecp256k1HdWallet } = require("@cosmjs/proto-signing");
// const { SigningStargateClient, assertIsDeliverTxSuccess } = require("@cosmjs/stargate");

// --- CẤU HÌNH ---
const STRATA_RPC = process.env.STRATA_RPC || "http://131.153.224.169:26757";
const BABYLON_RPC = "https://babylon-testnet-rpc.nodes.guru"; 
const BABYLON_DENOM = "ubbn";
const BATCH_SIZE = 10; // Gom 5 block Strata rồi mới gửi 1 lần

const MNEMONIC = process.env.BABYLON_MNEMONIC ? process.env.BABYLON_MNEMONIC.trim() : "";

// --- CẤU HÌNH BỎ QUA CHECK VÍ (Để test logic Merkle nếu không có mnemonic) ---
const SKIP_WALLET_CHECK = true; 

if (!MNEMONIC && !SKIP_WALLET_CHECK) {
    console.error("❌ LỖI: Thiếu BABYLON_MNEMONIC trong biến môi trường.");
    process.exit(1);
}

console.log(`🤖 STRATA TO BABYLON BATCHER & PROVER`);
console.log(`👉 Batch Size: ${BATCH_SIZE} | RPC: ${BABYLON_RPC}`);

// --- HÀM 1: LẤY BLOCK TỪ STRATA ---
async function getStrataBlock() {
    try {
        const res = await axios.get(`${STRATA_RPC}/status`);
        // Kiểm tra cấu trúc trả về tùy vào phiên bản Node RPC
        const info = res.data.result.sync_info; 
        return {
            height: parseInt(info.latest_block_height),
            hash: info.latest_block_hash
        };
    } catch (e) {
        // console.error("Lỗi kết nối Strata... (Retrying)"); 
        return null;
    }
}

// --- HÀM 2: GỬI GIAO DỊCH LÊN BABYLON ---
async function submitToBabylon(memoData) {
    if (SKIP_WALLET_CHECK) {
        console.log(`   ⚠️ [MOCK MODE] Giả lập gửi lên Babylon thành công.`);
        return "0xMOCK_TX_HASH_" + Date.now();
    }

    try {
        const { DirectSecp256k1HdWallet } = require("@cosmjs/proto-signing");
        const { SigningStargateClient, assertIsDeliverTxSuccess } = require("@cosmjs/stargate");

        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix: "bbn" });
        const [account] = await wallet.getAccounts();
        
        const client = await SigningStargateClient.connectWithSigner(BABYLON_RPC, wallet);

        const amount = { denom: BABYLON_DENOM, amount: "1" };
        const fee = {
            amount: [{ denom: BABYLON_DENOM, amount: "500" }],
            gas: "250000",
        };

        console.log(`   🚀 Đang bắn lên Babylon từ ví: ${account.address}`);

        const result = await client.sendTokens(
            account.address, account.address, [amount], fee, memoData 
        );

        assertIsDeliverTxSuccess(result);
        return result.transactionHash;

    } catch (error) {
        console.error(`   ❌ Lỗi Babylon: ${error.message}`);
        return null;
    }
}

// ==========================================
// --- 👇 CÁC HÀM MỚI VỀ MERKLE PROOF 👇 ---
// ==========================================

/**
 * Hàm tạo bằng chứng Merkle (Proof Path)
 * @param {MerkleTree} tree - Cây Merkle đã tạo
 * @param {string} leaf - Hash của phần tử cần chứng minh (đã qua SHA256)
 */
function getMerkleProof(tree, leaf) {
    const proof = tree.getProof(leaf);
    
    // Format lại proof cho dễ nhìn (chuyển Buffer sang Hex string)
    return proof.map(p => ({
        position: p.position === 'left' ? 'left' : 'right',
        data: p.data.toString('hex')
    }));
}

/**
 * Hàm xác thực bằng chứng (Verify)
 * @param {string} root - Merkle Root (Hex string)
 * @param {string} targetHash - Hash gốc của block cần kiểm tra (chưa qua SHA256)
 * @param {Array} proof - Mảng proof lấy từ hàm getMerkleProof
 */
function verifyMerkleProof(root, targetHash, proof) {
    // 1. Hash lại dữ liệu gốc để có Leaf
    const leaf = SHA256(targetHash);
    
    // 2. Chuyển đổi proof format về dạng Buffer để thư viện hiểu (nếu cần)
    // Thư viện merkletreejs verify nhận proof dạng object {data: Buffer, position: string}
    const formattedProof = proof.map(p => ({
        position: p.position,
        data: Buffer.from(p.data, 'hex')
    }));

    // 3. Gọi hàm verify của thư viện
    // Lưu ý: Phải truyền đúng hàm hash SHA256 vào
    const isValid = MerkleTree.verify(formattedProof, leaf, root, SHA256);
    
    return isValid;
}

// ==========================================

// --- HÀM 3: XỬ LÝ BATCH & MERKLE TREE ---
async function anchorBatch(batch) {
    const startHeight = batch[0].height;
    const endHeight = batch[batch.length - 1].height;
    
    console.log(`\n[🌳 MERKLE] Đang xử lý Block ${startHeight} -> ${endHeight}...`);

    // 1. Tạo lá (Leaves) - Chuyển hash sang SHA256 object
    const leaves = batch.map(b => SHA256(b.hash));
    
    // 2. Tạo cây Merkle
    const tree = new MerkleTree(leaves, SHA256);
    
    // 3. Lấy Root (Hex String)
    const root = tree.getRoot().toString('hex');
    
    console.log(`   🍃 Số lá: ${leaves.length}`);
    console.log(`   🌳 Merkle Root: ${root}`);

    // --- 👇 DEMO TẠO & CHECK PROOF NGAY TẠI ĐÂY 👇 ---
    // Giả sử ta muốn chứng minh Block đầu tiên trong Batch có nằm trong Root này không
    const targetBlock = batch[0]; 
    const targetLeaf = leaves[0]; // Leaf đã hash

    console.log(`   🔍 Demo: Tạo Proof cho Block ${targetBlock.height} (${targetBlock.hash.substring(0,10)}...)`);
    
    // A. Lấy Proof
    const proof = getMerkleProof(tree, targetLeaf);
    console.log(`   🧾 Proof Path:`, JSON.stringify(proof));

    // B. Verify Proof
    const isValid = verifyMerkleProof(root, targetBlock.hash, proof);
    if (isValid) {
        console.log(`   ✅ VERIFY THÀNH CÔNG: Block ${targetBlock.height} thuộc về Root này.`);
    } else {
        console.log(`   ❌ VERIFY THẤT BẠI!`);
    }
    // --------------------------------------------------

    // 4. Tạo nội dung Memo
    const memoPayload = `ENGRAM:${startHeight}:${endHeight}:${root}`;
    console.log(`   📦 Payload: ${memoPayload}`);

    // 5. Gửi lên Babylon
    const txHash = await submitToBabylon(memoPayload);
    
    if (txHash) {
        console.log(`   ✅ BATCH ANCHORED! Babylon Tx: ${txHash}`);
        console.log(`================================================`);
        return true;
    } else {
        return false;
    }
}

// --- MAIN LOOP ---
async function main() {
    let lastProcessedHeight = 0;
    let batchBuffer = []; 

    console.log("⏳ Đang lắng nghe block mới từ Strata...");

    // Dữ liệu giả lập để test nếu không kết nối được RPC (Bạn có thể xóa đoạn này khi chạy thật)
    /*
    batchBuffer = [
        { height: 100, hash: "HashA" },
        { height: 101, hash: "HashB" },
        { height: 102, hash: "HashC" },
        { height: 103, hash: "HashD" },
        { height: 104, hash: "HashE" }
    ];
    await anchorBatch(batchBuffer);
    return; 
    */

    while (true) {
        const block = await getStrataBlock();
        
        if (block && block.height > lastProcessedHeight) {
            
            // Check trùng
            const exists = batchBuffer.find(b => b.height === block.height);
            
            if (!exists) {
                // Thêm vào buffer
                batchBuffer.push(block);
                
                // Sort lại buffer theo height cho chắc chắn thứ tự đúng
                batchBuffer.sort((a, b) => a.height - b.height);

                console.log(`📥 Gom Block ${block.height} hash ${block.hash.substring(0, 10)}... (Buffer: ${batchBuffer.length}/${BATCH_SIZE})`);
                lastProcessedHeight = block.height;

                if (batchBuffer.length >= BATCH_SIZE) {
                    // Lấy đúng số lượng batch size (phòng trường hợp push dư)
                    const batchToSubmit = batchBuffer.slice(0, BATCH_SIZE);
                    
                    const success = await anchorBatch(batchToSubmit);
                    if (success) {
                        // Xóa các phần tử đã xử lý khỏi buffer
                        batchBuffer = batchBuffer.filter(b => b.height > batchToSubmit[batchToSubmit.length-1].height);
                    } else {
                        console.log("⚠️ Gửi thất bại, giữ buffer thử lại...");
                    }
                }
            }
        }
        
        await new Promise(r => setTimeout(r, 2000));
    }
}

main();