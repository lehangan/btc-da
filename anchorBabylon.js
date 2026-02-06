require('dotenv').config();
const axios = require('axios');
// Thư viện Merkle Tree
const { MerkleTree } = require('merkletreejs');
const SHA256 = require('crypto-js/sha256');

// Thư viện Babylon (Cosmos SDK)
const { DirectSecp256k1HdWallet } = require("@cosmjs/proto-signing");
const { SigningStargateClient, assertIsDeliverTxSuccess } = require("@cosmjs/stargate");

// --- CẤU HÌNH ---
const STRATA_RPC = process.env.STRATA_RPC || "http://131.153.224.169:26757";
const BABYLON_RPC = "https://babylon-testnet-rpc.nodes.guru"; // Hoặc dùng nodes.guru nếu thích
const BABYLON_DENOM = "ubbn";
const BATCH_SIZE = 5; // Gom 5 block Strata rồi mới gửi 1 lần

const MNEMONIC = process.env.BABYLON_MNEMONIC ? process.env.BABYLON_MNEMONIC.trim() : "";
if (!MNEMONIC) {
    console.error("❌ LỖI: Thiếu BABYLON_MNEMONIC trong biến môi trường.");
    process.exit(1);
}

console.log(`🤖 STRATA TO BABYLON BATCHER`);
console.log(`👉 Batch Size: ${BATCH_SIZE} | RPC: ${BABYLON_RPC}`);

// --- HÀM 1: LẤY BLOCK TỪ STRATA (Giữ nguyên logic cũ) ---
async function getStrataBlock() {
    try {
        const res = await axios.get(`${STRATA_RPC}/status`);
        const info = res.data.result.sync_info;
        return {
            height: parseInt(info.latest_block_height),
            hash: info.latest_block_hash
        };
    } catch (e) {
        // console.error("Lỗi kết nối Strata:", e.message); 
        return null;
    }
}

// --- HÀM 2: GỬI GIAO DỊCH LÊN BABYLON (Logic mới) ---
async function submitToBabylon(memoData) {
    try {
        // 1. Khôi phục ví
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix: "bbn" });
        const [account] = await wallet.getAccounts();
        
        // 2. Kết nối Client
        const client = await SigningStargateClient.connectWithSigner(BABYLON_RPC, wallet);

        // 3. Cấu hình phí và số tiền (Gửi 1 ubbn cho chính mình)
        const amount = { denom: BABYLON_DENOM, amount: "1" };
        const fee = {
            amount: [{ denom: BABYLON_DENOM, amount: "500" }], // Tăng fee lên chút cho mượt
            gas: "250000",
        };

        console.log(`   🚀 Đang bắn lên Babylon từ ví: ${account.address}`);

        // 4. Gửi Tx kèm MEMO
        const result = await client.sendTokens(
            account.address, // Từ mình
            account.address, // Sang mình
            [amount],
            fee,
            memoData // <--- QUAN TRỌNG: Root nằm ở đây
        );

        assertIsDeliverTxSuccess(result);
        return result.transactionHash;

    } catch (error) {
        console.error(`   ❌ Lỗi Babylon: ${error.message}`);
        return null;
    }
}

// --- HÀM 3: XỬ LÝ BATCH & MERKLE TREE ---
async function anchorBatch(batch) {
    const startHeight = batch[0].height;
    const endHeight = batch[batch.length - 1].height;
    
    console.log(`\n[🌳 MERKLE] Đang xử lý Block ${startHeight} -> ${endHeight}...`);

    // 1. Tạo lá (Leaves)
    const leaves = batch.map(b => SHA256(b.hash));
    
    // 2. Tạo cây Merkle
    const tree = new MerkleTree(leaves, SHA256);
    
    // 3. Lấy Root
    const root = tree.getRoot().toString('hex');
    
    console.log(`   🍃 Số lá: ${leaves.length}`);
    console.log(`   🌳 Merkle Root: ${root}`);

    // 4. Tạo nội dung Memo: "STRATA:Start:End:Root"
    const memoPayload = `STRATA:${startHeight}:${endHeight}:${root}`;
    console.log(`   📦 Payload: ${memoPayload}`);

    // 5. GỌI HÀM GỬI LÊN BABYLON
    const txHash = await submitToBabylon(memoPayload);
    
    if (txHash) {
        console.log(`   ✅ BATCH ANCHORED! Babylon Tx: ${txHash}`);
        console.log(`================================================`);
        return true;
    } else {
        return false;
    }
}

// --- MAIN LOOP (Giữ nguyên logic cũ) ---
async function main() {
    let lastProcessedHeight = 0;
    let batchBuffer = []; // Mảng chứa các block đang gom

    console.log("⏳ Đang lắng nghe block mới từ Strata...");

    while (true) {
        const block = await getStrataBlock();
        
        // Chỉ xử lý block mới
        if (block && block.height > lastProcessedHeight) {
            
            // Nếu block cách xa quá (ví dụ mới bật lại bot), ta có thể skip hoặc sync từ từ.
            // Ở đây giữ logic đơn giản: cứ thấy mới là gom.
            
            // Check trùng để tránh duplicate trong buffer
            const exists = batchBuffer.find(b => b.height === block.height);
            
            if (!exists) {
                batchBuffer.push(block);
                console.log(`📥 Gom Block ${block.height} hash ${block.hash.substring(0, 10)}... (Buffer: ${batchBuffer.length}/${BATCH_SIZE})`);
                lastProcessedHeight = block.height;

                // Nếu gom đủ số lượng -> Gửi đi
                if (batchBuffer.length >= BATCH_SIZE) {
                    const success = await anchorBatch(batchBuffer);
                    if (success) {
                        batchBuffer = []; // Reset bộ đệm thành công
                    } else {
                        console.log("⚠️ Gửi thất bại, sẽ thử lại ở lượt sau...");
                        // Giữ nguyên buffer để retry
                    }
                }
            }
        }
        
        await new Promise(r => setTimeout(r, 2000)); // Nghỉ 2s rồi check tiếp
    }
}

main();