const axios = require('axios');
const crypto = require('crypto');

// --- CẤU HÌNH ---
const DB_API_URL = 'http://188.166.217.182:8084/transactions';
const TARGET_TX_HASH = 'FB8E26A252C441474E77840DC4F48BDAB4A8813D78A4F66A231F72F7BEA4256A';
const CONSENSUS_RPC = 'http://131.153.224.169:26757';

// --- HELPER FUNCTION ---
const randomHex = (len) => crypto.randomBytes(len).toString('hex').toUpperCase();


async function getLayer1_Celestia(txHash) {
    try {
        console.log(`📡 [Layer 1] Fetching Transaction Data...`);
        
        // BƯỚC 1: Lấy thông tin Transaction từ Database
        const txResponse = await axios.get(`${DB_API_URL}/${txHash}`);
        const txData = txResponse.data;

        if (!txData) throw new Error("Transaction not found in DB");

        const height = txData.height;
        console.log(`   ↳ Found Height: ${height}. Fetching Block Hash...`);

        // BƯỚC 2: Lấy Block Hash từ Consensus RPC
        // URL: http://131.153.224.169:26757/block?height=XXXXXX
        let realBlockHash = "UNKNOWN_HASH";
        try {
            const blockResponse = await axios.get(`${CONSENSUS_RPC}/block?height=${height}`);
            // Cấu trúc trả về thường là: result -> block_id -> hash
            if (blockResponse.data && blockResponse.data.result && blockResponse.data.result.block_id) {
                realBlockHash = blockResponse.data.result.block_id.hash;
            }
        } catch (rpcError) {
            console.error("   ⚠️ Warning: Could not fetch Block Hash from RPC:", rpcError.message);
            // Nếu lỗi RPC thì vẫn giữ code chạy tiếp, chỉ hash là bị thiếu
        }

        console.log(`   ✅ Block Hash: ${realBlockHash}`);

        // Format dữ liệu trả về
        return {
            tx_hash: txData.hash,
            height: txData.height,
            block_hash: realBlockHash, // <--- Đã là Hash thật 100%
            timestamp: txData.timestamp,
            signer: (txData.blobs && txData.blobs.length > 0) ? txData.blobs[0].signer : "Unknown Signer",
            
            // Dữ liệu nội bộ để dùng tính toán cho các layer sau
            _internal_height: txData.height, 
            _internal_time: txData.timestamp
        };

    } catch (error) {
        console.error("❌ Error Layer 1:", error.message);
        return null;
    }
}


// ==========================================
// HÀM 2: LAYER 2 - BATCH AGGREGATION (MOCKUP)
// Nhiệm vụ: Gom nhóm các block Celestia (Logic: 200 block/batch)
// ==========================================
function getLayer2_Batch(layer1Data) {
    if (!layer1Data) return null;
    console.log(`⚙️ [Layer 2] Mocking Batch Aggregation...`);

    const height = layer1Data._internal_height;
    const BATCH_SIZE = 200;

    // Tính toán Start/End dựa trên Height thật
    // Ví dụ: Height 301245 -> Batch 301200 - 301400
    const startHeight = Math.floor(height / BATCH_SIZE) * BATCH_SIZE;
    const endHeight = startHeight + BATCH_SIZE;

    // Tạo Merkle Root giả (Sau này sẽ lấy từ STRATA Node)
    const mockRoot = randomHex(32).toLowerCase();

    return {
        batch_type: "merkle_sum_tree",
        start_height: startHeight,
        end_height: endHeight,
        leaves_count: BATCH_SIZE,
        merkle_root: mockRoot, // <--- Key quan trọng để link sang Layer 3
        inclusion_proof: `proof_path_from_${height}_to_root`,
        _internal_root: mockRoot // Truyền sang Layer 3
    };
}


// ==========================================
// HÀM 3: LAYER 3 - BABYLON CHAIN (MOCKUP)
// Nhiệm vụ: Timestamping cái Batch Root lên Babylon
// ==========================================
function getLayer3_Babylon(layer2Data) {
    if (!layer2Data) return null;
    console.log(`cw [Layer 3] Mocking Babylon Checkpoint...`);

    // Giả lập Epoch Babylon (tăng dần theo Batch)
    const epoch = Math.floor(layer2Data.start_height / 1000) + 500;
    
    return {
        tx_hash: randomHex(32),
        height: epoch * 360 + 15, // Block Babylon
        epoch: epoch,
        // PAYLOAD PHẢI CHỨA ROOT CỦA LAYER 2
        memo_payload: `STRATA:${layer2Data.start_height}:${layer2Data.end_height}:${layer2Data._internal_root}`,
        timestamp: Date.now(), // Thời gian checkpoint
        _internal_epoch: epoch // Truyền sang Layer 4
    };
}


// ==========================================
// HÀM 4: LAYER 4 - BITCOIN (MOCKUP)
// Nhiệm vụ: Finalize Epoch của Babylon
// ==========================================
function getLayer4_Bitcoin(layer3Data) {
    if (!layer3Data) return null;
    console.log(`bf [Layer 4] Mocking Bitcoin Finality...`);

    return {
        tx_hash: randomHex(32),
        height: 800000 + layer3Data._internal_epoch, // Block Bitcoin cao hơn
        babylon_epoch_finalized: layer3Data._internal_epoch,
        // OP_RETURN chứa thông tin Epoch
        op_return_data: `BABYLON_EPOCH_${layer3Data._internal_epoch}_CHECKPOINT`
    };
}


// ==========================================
// HÀM CHÍNH: ORCHESTRATOR (ĐIỀU PHỐI)
// ==========================================
async function main() {
    console.log(`\n🚀 BẮT ĐẦU TRUY VẾT TX: ${TARGET_TX_HASH}\n`);

    // 1. Lấy dữ liệu thật
    const layer1 = await getLayer1_Celestia(TARGET_TX_HASH);
    
    if (layer1) {
        // 2. Mockup các tầng trên dựa theo dữ liệu thật tầng dưới
        const layer2 = getLayer2_Batch(layer1);
        const layer3 = getLayer3_Babylon(layer2);
        const layer4 = getLayer4_Bitcoin(layer3);

        // 3. Ghép kết quả cuối cùng
        const finalResult = {
            hash: layer1.tx_hash,
            height: layer1.height,
            status: "anchored_on_bitcoin",
            proof_chain: {
                layer_1_data_availability_layer: layer1,
                // layer_2_batch_aggregation: layer2,
                // layer_3_babylon: layer3,
                // layer_4_bitcoin: layer4
            }
        };

        // Xóa các trường nội bộ (_internal) cho sạch đẹp trước khi in
        // delete finalResult.proof_chain.layer_1_data_availability_layer._internal_height;
        // delete finalResult.proof_chain.layer_1_data_availability_layer._internal_time;
        // delete finalResult.proof_chain.layer_2_batch_aggregation._internal_root;
        // delete finalResult.proof_chain.layer_3_babylon._internal_epoch;

        console.log("\n✅ KẾT QUẢ JSON HOÀN CHỈNH:\n");
        console.log(JSON.stringify(finalResult, null, 2));
    }
}

// Chạy chương trình
main();