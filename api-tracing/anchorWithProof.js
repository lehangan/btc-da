require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { MerkleTree } = require('merkletreejs');
const SHA256 = require('crypto-js/sha256');
const crypto = require('crypto');

// --- CẤU HÌNH ---
const STRATA_RPC = process.env.STRATA_RPC || "http://131.153.224.169:26757";
const BABYLON_RPC = "https://babylon-testnet-rpc.nodes.guru"; 
const BATCH_SIZE = 5; 
const STATE_FILE = path.join(__dirname, 'state.json');
const PROOFS_DIR = path.join(__dirname, 'proofs');

// Tạo thư mục proofs nếu chưa có
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR);

const MNEMONIC = process.env.BABYLON_MNEMONIC ? process.env.BABYLON_MNEMONIC.trim() : "";
const SKIP_WALLET_CHECK = true; 

// ==========================================
// 1. STATE MANAGEMENT
// ==========================================

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
            return state?.last_processed_height ? parseInt(state.last_processed_height) : null;
        }
    } catch (e) { 
        console.error("⚠️ Lỗi đọc state:", e.message); 
    }
    return null;
}

function saveState(height) {
    const state = { 
        last_processed_height: height, 
        updated_at: new Date().toISOString() 
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ==========================================
// 2. MERKLE TREE & PROOF GENERATION
// ==========================================

/**
 * Hash block data using SHA256
 */
function hashBlock(blockData) {
    if (typeof blockData === 'string') {
        return crypto.createHash('sha256').update(blockData).digest();
    }
    return SHA256(JSON.stringify(blockData));
}

/**
 * Build merkle tree from block hashes
 */
function buildMerkleTree(blocks) {
    const leaves = blocks.map(block => {
        if (typeof block.hash === 'string') {
            return Buffer.from(block.hash, 'hex');
        }
        return Buffer.isBuffer(block.hash) ? block.hash : Buffer.from(String(block.hash), 'hex');
    });
    console.log('[DEBUG] Merkle leaves:', leaves.map(b => b.toString('hex')));
    // Define proper hash function for MerkleTree
    const hashFunction = (data) => {
        return crypto.createHash('sha256').update(data).digest();
    };
    const tree = new MerkleTree(leaves, hashFunction, {
        hashLeaves: false,
        duplicateOdd: false,
        sortPairs: true // Sửa lại để Merkle proof đúng chuẩn
    });
    console.log('[DEBUG] Merkle tree root:', tree.getRoot().toString('hex'));
    return tree;
}

/**
 * Get merkle root from tree
 */
function getMerkleRoot(tree) {
    return tree.getRoot().toString('hex');
}

/**
 * Generate merkle proof path for a specific block in the tree
 * Returns array of sibling hashes needed to reconstruct root
 */
function generateMerkleProof(tree, blockIndex) {
    const proof = tree.getProof(blockIndex);
    
    if (!proof || proof.length === 0) {
        return {
            path: [],
            leaf_index: blockIndex,
            tree_size: tree.getLeaves().length
        };
    }

    const path = proof.map((node, idx) => ({
        sibling_hash: node.data.toString('hex'),
        position: node.position === 'left' ? 'left' : 'right',
        level: idx
    }));

    return {
        path,
        leaf_index: blockIndex,
        tree_size: tree.getLeaves().length
    };
}

/**
 * Generate merkle root paths for all blocks in batch
 */
function generateBatchMerkleProofs(blocks, tree) {
    const proofs = blocks.map((block, idx) => {
        const proof = generateMerkleProof(tree, idx);
        if (!proof.path || proof.path.length === 0) {
            console.warn(`[DEBUG] Block height ${block.height} index ${idx} has empty merkle path!`);
        } else {
            console.log(`[DEBUG] Block height ${block.height} index ${idx} merkle path:`, proof.path);
        }
        return {
            block: {
                height: block.height,
                hash: block.hash
            },
            merkle_proof: {
                index: proof.leaf_index,
                root: getMerkleRoot(tree),
                path: proof.path,
                tree_size: proof.tree_size
            }
        };
    });
    return proofs;
}

/**
 * Verify merkle proof for a block (optional utility)
 */
function verifyMerkleProof(blockHash, proof, merkleRoot) {
    const pathArray = proof.path.map(p => Buffer.from(p.sibling_hash, 'hex'));
    
    try {
        const computedRoot = MerkleTree.verify(
            pathArray,
            Buffer.from(blockHash, 'hex'),
            MerkleTree.hashLeaves ? undefined : crypto.createHash('sha256').update.bind(crypto.createHash('sha256')),
            proof.index
        );
        return Buffer.from(merkleRoot, 'hex').equals(computedRoot);
    } catch (e) {
        return false;
    }
}

/**
 * Save merkle proofs to file
 */
function saveMerkleProofsToFile(startHeight, endHeight, merkleRoot, proofs, txHash) {
    const filename = `batch-${startHeight}-${endHeight}.json`;
    const filePath = path.join(PROOFS_DIR, filename);
    
    const data = {
        batch_info: { 
            startHeight, 
            endHeight, 
            total_blocks: proofs.length,
            merkle_root: merkleRoot, 
            babylon_tx: txHash,
            created_at: new Date().toISOString()
        },
        merkle_proofs: proofs
    };
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`   💾 Đã lưu Merkle Proofs vào: ${filename}`);
    
    return filePath;
}


// ==========================================
// 3. CORE LOGIC - ANCHOR & MERKLE
// ==========================================

/**
 * Process a batch of blocks:
 * 1. Build Merkle tree
 * 2. Generate proofs for each block
 * 3. Submit root to Babylon
 * 4. Save proofs to file
 */
async function processBatch(blocks) {
    if (!blocks || blocks.length === 0) {
        console.warn("⚠️ Batch trống");
        return false;
    }

    const startHeight = blocks[0].height;
    const endHeight = blocks[blocks.length - 1].height;
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`[🌳 MERKLE] Xử lý Batch: ${startHeight} -> ${endHeight} (${blocks.length} blocks)`);

    try {
        // 1. Build Merkle tree
        const tree = buildMerkleTree(blocks);
        const merkleRoot = getMerkleRoot(tree);
        
        console.log(`   🌳 Merkle Root: ${merkleRoot}`);

        // 2. Generate merkle proofs for each block
        const proofs = generateBatchMerkleProofs(blocks, tree);
        
        console.log(`   ✅ Sinh ${proofs.length} merkle proofs thành công`);

        // 3. Submit to Babylon
        const memoPayload = `ENGRAM:${startHeight}:${endHeight}:${merkleRoot}`;
        const txHash = await submitToBabylon(memoPayload);
        
        if (txHash) {
            console.log(`   🚀 ANCHORED! Tx: ${txHash}`);
            
            // 4. Save proofs to file
            saveMerkleProofsToFile(startHeight, endHeight, merkleRoot, proofs, txHash);
            
            return true;
        } else {
            console.error("   ❌ Lỗi submit tới Babylon");
            return false;
        }
    } catch (error) {
        console.error(`   ❌ Lỗi xử lý batch: ${error.message}`);
        return false;
    }
}

// ==========================================
// 4. RPC COMMUNICATION
// ==========================================

async function getLatestBlockHeight() {
    try {
        const res = await axios.get(`${STRATA_RPC}/status`, { timeout: 5000 });
        return parseInt(res.data.result.sync_info.latest_block_height);
    } catch (e) { 
        console.error("❌ RPC Error (latest height):", e.message);
        return null; 
    }
}

async function getBlockByHeight(height) {
    try {
        const res = await axios.get(`${STRATA_RPC}/block?height=${height}`, { timeout: 5000 });
        const blockData = res.data.result;
        
        return {
            height: parseInt(blockData.block.header.height),
            hash: blockData.block_id.hash,
            timestamp: blockData.block.header.time
        };
    } catch (e) { 
        return null; 
    }
}

async function submitToBabylon(memoData) {
    if (SKIP_WALLET_CHECK) {
        await new Promise(r => setTimeout(r, 500));
        return "0xMOCK_TX_HASH_" + Date.now();
    }
    // Thực tế sẽ dùng SigningStargateClient ở đây
    return null;
}


// ==========================================
// 5. MAIN LOOP
// ==========================================

/**
 * Initialize starting height
 */
async function initializeStartHeight() {
    const lastSavedHeight = loadState();
    if (lastSavedHeight) {
        console.log(`🔄 RESUME: Block ${lastSavedHeight + 1}`);
        return lastSavedHeight + 1;
    }
    
    if (process.env.START_BLOCK) {
        const startBlock = parseInt(process.env.START_BLOCK);
        console.log(`⚙️ CONFIG: Block ${startBlock}`);
        return startBlock;
    }
    
    const latest = await getLatestBlockHeight();
    if (latest) {
        console.log(`🌍 LATEST: Block ${latest}`);
        return latest;
    }
    
    throw new Error("❌ Không thể xác định block bắt đầu");
}

/**
 * Main processing loop
 */
async function main() {
    console.log("=".repeat(50));
    console.log("🤖 MERKLE PROOF GENERATOR STARTED");
    console.log("=".repeat(50));

    let currentHeight = 0;
    let batchBuffer = [];
    let retryCount = 0;
    const MAX_RETRIES = 5;

    try {
        currentHeight = await initializeStartHeight();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    while (true) {
        try {
            const block = await getBlockByHeight(currentHeight);
            
            if (block) {
                batchBuffer.push(block);
                const progress = `Buffer: ${batchBuffer.length}/${BATCH_SIZE} | Block ${currentHeight}`;
                process.stdout.write(`\r📥 ${progress}`);
                
                currentHeight++;
                retryCount = 0; // Reset retry count on success

                // Process batch when full
                if (batchBuffer.length >= BATCH_SIZE) {
                    console.log("\n");
                    const success = await processBatch(batchBuffer);
                    
                    if (success) {
                        saveState(batchBuffer[batchBuffer.length - 1].height);
                        batchBuffer = [];
                        await new Promise(r => setTimeout(r, 1000)); // Wait before next batch
                    } else {
                        console.error("❌ Batch processing failed, retrying...");
                        await new Promise(r => setTimeout(r, 5000));
                    }
                } else {
                    await new Promise(r => setTimeout(r, 100)); // Small delay between blocks
                }
            } else {
                // Block not found - chain might be syncing
                process.stdout.write(`\r⏳ Waiting for block ${currentHeight}...`);
                
                retryCount++;
                if (retryCount > MAX_RETRIES) {
                    console.log("\n⚠️ Max retries reached, checking latest height...");
                    const latest = await getLatestBlockHeight();
                    if (latest && latest < currentHeight) {
                        console.log(`   Latest height: ${latest}, resetting to ${latest}`);
                        currentHeight = latest;
                        retryCount = 0;
                    }
                }
                
                await new Promise(r => setTimeout(r, 3000)); // Wait before retry
            }
        } catch (error) {
            console.error(`\n❌ Loop error: ${error.message}`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// Start the application
main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});