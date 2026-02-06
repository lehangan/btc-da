const axios = require('axios');

// Cấu hình Endpoint
const BABYLON_RPC = "https://babylon-testnet-rpc.nodes.guru"; // Cổng 26657 (Consensus)
const BABYLON_API = "https://babylon-testnet-api.nodes.guru"; // Cổng 1317 (Application/LCD)

// Hash giao dịch bạn muốn soi
const TX_HASH = "44F26A522641C0AAD82A897891B713D574BCA36E35E9F927F50E1B803F626D4D";

/**
 * 1. Lấy thông tin Transaction để tìm Block Height và Index
 */
async function getTxIndex() {
    try {
        console.log("-------------------------------------------------");
        console.log("🔍 1. Đang tìm Transaction...");

        // QUAN TRỌNG: Thêm 0x vào trước Hash
        const url = `${BABYLON_RPC}/tx?hash=0x${TX_HASH}`;
        const response = await axios.get(url);
        const data = response.data;

        if (data.result) {
            const height = data.result.height;
            const index = data.result.index;
            console.log(`✅ Đã tìm thấy Tx!`);
            console.log(`   - Block Height: ${height}`);
            console.log(`   - Tx Index:     ${index}`);
            console.log(data);
            return height; // Trả về Height để dùng cho bước sau
        } else {
            console.log("❌ Không tìm thấy Tx (API trả về null)");
            return null;
        }

    } catch (error) {
        // Xử lý riêng lỗi RPC trả về (ví dụ lỗi không tìm thấy hash)
        if (error.response && error.response.data && error.response.data.error) {
            console.log("❌ Lỗi RPC:", error.response.data.error.data);
        } else {
            console.error("❌ Lỗi mạng:", error.message);
        }
        return null;
    }
}

async function getBlock(height) {
    if (!height) return;

    try {
        console.log("-------------------------------------------------");
        console.log(`📦 Đang tải Block #${height}...`);

        const url = `${BABYLON_RPC}/block?height=${height}`;
        const response = await axios.get(url);

        // 1. Lấy Block ID (Hash của block)
        const blockId = response.data.result.block_id;

        // 2. Lấy nội dung Block
        const blockContent = response.data.result.block;
        const txCount = blockContent.data.txs ? blockContent.data.txs.length : 0;

        console.log(`✅ KẾT QUẢ CHI TIẾT:`);
        console.log(`   💎 BLOCK HASH:  ${blockId.hash}`); // <--- Đây là cái bạn cần
        console.log(`   - Time:         ${blockContent.header.time}`);
        console.log(`   - Proposer:     ${blockContent.header.proposer_address}`);
        console.log(`   - App Hash:     ${blockContent.header.app_hash}`);
        console.log(`   - Số giao dịch trong block:  ${txCount} txs`);

    } catch (error) {
        console.error("❌ Lỗi lấy Block:", error.message);
    }
}

async function getEpochOfBlock(blockHeight) {
    if (!blockHeight) return null;

    try {
        console.log("-------------------------------------------------");
        console.log(`🔍 Đang dò tìm Epoch chính xác cho Block #${blockHeight}...`);

        // 1. Lấy interval thực tế từ hệ thống để có con số ước tính ban đầu
        const urlParams = `${BABYLON_API}/babylon/epoching/v1/params`;
        const resParams = await axios.get(urlParams);
        const interval = BigInt(resParams.data.params.epoch_interval);

        // 2. Ước tính số Epoch (Giả sử bắt đầu từ 0)
        let estimatedEpoch = Number(BigInt(blockHeight) / interval);

        // 3. Vòng lặp dò tìm (thường chỉ chạy 1-2 lần là khớp)
        let found = false;
        let finalEpoch = estimatedEpoch;

        // Thử kiểm tra Epoch ước tính và các Epoch lân cận (+/- 1)
        const candidates = [estimatedEpoch, estimatedEpoch + 1, estimatedEpoch - 1];

        for (let epoch of candidates) {
            if (epoch < 0) continue;
            
            const info = await getEpochInfo(epoch);
            if (info) {
                const first = BigInt(info.first_block_height);
                const last = first + BigInt(info.current_epoch_interval) - 1n;

                if (BigInt(blockHeight) >= first && BigInt(blockHeight) <= last) {
                    finalEpoch = epoch;
                    found = true;
                    console.log(`✅ ĐÃ XÁC THỰC: Block ${blockHeight} nằm trong Epoch ${epoch}`);
                    console.log(`   Phạm vi: [${first} ---> ${last}]`);
                    break;
                }
            }
        }

        if (!found) {
            // Nếu vẫn không tìm thấy trong các lân cận, gọi API lấy Epoch hiện tại để so sánh
            console.log("⚠️ Không tìm thấy trong phạm vi ước tính, đang kiểm tra Epoch hiện tại...");
            const resCurr = await axios.get(`${BABYLON_API}/babylon/epoching/v1/epochs/current`);
            finalEpoch = parseInt(resCurr.data.epoch.epoch_number);
        }

        return finalEpoch;

    } catch (error) {
        console.error("❌ Lỗi trong quá trình dò tìm Epoch:", error.message);
        return null;
    }
}

async function getEpochInfo(epochNum) {
    try {
        const url = `${BABYLON_API}/babylon/epoching/v1/epochs/${epochNum}`;
        const res = await axios.get(url);
        return res.data.epoch;
    } catch (e) { return null; }
}

async function getBtcCheckpoint(epochNum) {
    try {
        // Lưu ý: nodes.guru có thể yêu cầu path /checkpoints/{epoch_num}
        const url = `${BABYLON_API}/babylon/btccheckpoint/v1/${epochNum}`;
        const res = await axios.get(url);
        console.log(res);
        return result = {
            block_btc_height: res.data.info.best_submission_btc_block_height,
            block_btc_hash: res.data.info.best_submission_btc_block_hash,
            submission_hash: res.data.info.best_submission_transactions
        }
    } catch (e) { return null; }
}

async function main() {
    // 1. Lấy Block Height từ Tx ban đầu
    const height = await getTxIndex();

    if (height) {
        // 2. Lấy thông tin Block
        await getBlock(height);

        // 3. Tính toán xem Block đó thuộc Epoch nào
        // Hàm này nên TRẢ VỀ giá trị targetEpoch
        const epoch = await getEpochOfBlock(height);
        let info = await getBtcCheckpoint(epoch);
        console.log(info);
    }
}

main();

