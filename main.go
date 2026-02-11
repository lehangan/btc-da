// package main

// import (
// 	"bytes"
// 	"context"
// 	"crypto/sha256" // Thêm thư viện này để tính Hash
// 	"encoding/base64"
// 	"encoding/hex"
// 	"encoding/json"
// 	"fmt"
// 	"io"
// 	"io/ioutil"
// 	"log"
// 	mrand "math/rand"
// 	"net/http"
// 	"os"
// 	"strings" // Thêm thư viện này để viết hoa Hash
// 	"time"

// 	client "github.com/celestiaorg/celestia-node/api/rpc/client"
// 	"github.com/celestiaorg/celestia-node/blob"
// 	"github.com/celestiaorg/celestia-node/state"
// 	share "github.com/celestiaorg/go-square/v3/share"
// )

// // --- CẤU HÌNH ---
// const (
// 	RPCURL       = "http://localhost:26758" // Node RPC
// 	ConsensusURL = "http://localhost:26757" // Consensus RPC
// 	AuthToken    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBbGxvdyI6WyJwdWJsaWMiLCJyZWFkIiwid3JpdGUiLCJhZG1pbiJdLCJOb25jZSI6InJaMzBXMWsrZk1yaHRuL2RBL2FITVdsV0xWL0R6eXpvL085QTErV1hTMXc9IiwiRXhwaXJlc0F0IjoiMDAwMS0wMS0wMVQwMDowMDowMFoifQ.nQrNnpPCjRRB5HJD0PLmFyV6ey8bzunPph-cJnCntLk"
// 	BaseDir      = "./dataSubmit"
// 	MaxChunkSize = 7835388
// 	FileFullMeta = "./full_data.json"
// 	// SỬA LẠI URL CHÍNH XÁC
// 	DatabaseAPI = "http://188.166.217.182:8084/data/submit-tx"
// )

// var Namespaces = []string{"0064656653656E736F72"}

// // --- CẤU TRÚC DỮ LIỆU ---

// type BlockResult struct {
// 	Height    uint64       `json:"height"`
// 	Timestamp int64        `json:"timestamp"`
// 	Index     int          `json:"index"`
// 	Hash      string       `json:"hash"` // Block Hash
// 	Count     int          `json:"count"`
// 	Blobs     []BlobDetail `json:"blobs"`
// }

// type BlobDetail struct {
// 	Height     uint64 `json:"height"`
// 	Index      int    `json:"index"`
// 	Namespace  string `json:"namespace"`
// 	Commitment string `json:"commitment"`
// 	Signer     string `json:"signer"`
// 	Size       int    `json:"size"`
// 	Hash       string `json:"hash"` // <-- Đã thêm lại trường Hash (TxHash)
// 	Timestamp  int64  `json:"timestamp"`
// }

// type ConsensusBlockResponse struct {
// 	Result struct {
// 		BlockID struct {
// 			Hash string `json:"hash"`
// 		} `json:"block_id"`
// 		Block struct {
// 			Header struct {
// 				Height string `json:"height"`
// 				Time   string `json:"time"`
// 			} `json:"header"`
// 			Data struct {
// 				Txs []string `json:"txs"` // Mảng Transaction Base64
// 			} `json:"data"`
// 		} `json:"block"`
// 	} `json:"result"`
// }

// func main() {
// 	mrand.Seed(time.Now().UnixNano())
// 	ctx := context.Background()

// 	ctxWithTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
// 	defer cancel()
// 	c, err := client.NewClient(ctxWithTimeout, RPCURL, AuthToken)
// 	if err != nil {
// 		log.Fatalf("❌ Lỗi RPC: %v", err)
// 	}

// 	fmt.Println("🤖 Bot Celestia Uploader đang chạy...")
// 	fmt.Printf("📡 Database: %s\n", DatabaseAPI)

// 	if _, err := os.Stat(BaseDir); os.IsNotExist(err) {
// 		os.MkdirAll(BaseDir, 0755)
// 		os.WriteFile(fmt.Sprintf("%s/test.txt", BaseDir), []byte("Hello DB"), 0644)
// 	}

// 	for {
// 		files, err := ioutil.ReadDir(BaseDir)
// 		if err != nil || len(files) == 0 {
// 			log.Printf("⚠️ Không có file, đợi 10s...")
// 			time.Sleep(10 * time.Second)
// 			continue
// 		}

// 		targetFile := files[0]
// 		filePath := fmt.Sprintf("%s/%s", BaseDir, targetFile.Name())
// 		fmt.Printf("\n📂 Xử lý: %s (%d bytes)\n", targetFile.Name(), targetFile.Size())

// 		processAndSubmitFile(ctx, c, filePath)

// 		fmt.Println("💤 Chờ 30s...")
// 		time.Sleep(30 * time.Second)
// 	}
// }

// func processAndSubmitFile(ctx context.Context, c *client.Client, filePath string) {
// 	file, err := os.Open(filePath)
// 	if err != nil {
// 		return
// 	}
// 	defer file.Close()

// 	buffer := make([]byte, MaxChunkSize)
// 	partNum := 1

// 	for {
// 		n, err := file.Read(buffer)
// 		if n > 0 {
// 			chunkData := make([]byte, n)
// 			copy(chunkData, buffer[:n])
// 			nsHex := Namespaces[mrand.Intn(len(Namespaces))]

// 			blockResult := submitChunkAndGetInfo(ctx, c, partNum, chunkData, nsHex)
// 			if blockResult != nil {
// 				submitToAPI(*blockResult)
// 				// saveToFiles(*blockResult)
// 			}
// 			partNum++
// 		}
// 		if err == io.EOF {
// 			break
// 		}
// 	}
// }

// // Hàm lưu file JSON

// func saveToFiles(data BlockResult) {

// 	var fullList []BlockResult

// 	// Đọc file cũ

// 	content, err := ioutil.ReadFile(FileFullMeta)

// 	if err == nil {

// 		json.Unmarshal(content, &fullList)

// 	}

// 	// Thêm mới vào đầu danh sách (Prepend)

// 	fullList = append([]BlockResult{data}, fullList...)

// 	// Giới hạn lưu 100 bản ghi mới nhất (tùy chọn)

// 	if len(fullList) > 100 {

// 		fullList = fullList[:100]

// 	}

// 	// Ghi file

// 	fileData, _ := json.MarshalIndent(fullList, "", " ")

// 	ioutil.WriteFile(FileFullMeta, fileData, 0644)

// 	fmt.Println("💾 Đã lưu Metadata vào file JSON.")

// }

// func submitToAPI(data BlockResult) {
// 	jsonData, _ := json.Marshal(data)
// 	req, _ := http.NewRequest("POST", DatabaseAPI, bytes.NewBuffer(jsonData))
// 	req.Header.Set("Content-Type", "application/json")
// 	req.Header.Set("accept", "*/*")

// 	client := &http.Client{Timeout: 10 * time.Second}
// 	resp, err := client.Do(req)
// 	if err != nil {
// 		log.Printf("❌ Lỗi DB API: %v", err)
// 		return
// 	}
// 	defer resp.Body.Close()

// 	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
// 		fmt.Printf("💾 [DB SAVE] OK! Status: %d\n", resp.StatusCode)
// 	} else {
// 		body, _ := io.ReadAll(resp.Body)
// 		fmt.Printf("⚠️ [DB FAIL] Status %d: %s\n", resp.StatusCode, string(body))
// 	}
// }

// func submitChunkAndGetInfo(ctx context.Context, c *client.Client, partID int, data []byte, nsHex string) *BlockResult {
// 	nsBytes, _ := hex.DecodeString(nsHex)
// 	nsp, _ := share.NewV0Namespace(nsBytes)
// 	nsBase64 := base64.StdEncoding.EncodeToString(nsp.Bytes())
// 	newBlob, _ := blob.NewBlobV0(nsp, data)

// 	fmt.Printf("\n📦 [Part %d] Gửi %d bytes...\n", partID, len(data))
// 	submitCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
// 	defer cancel()

// 	height, err := c.Blob.Submit(submitCtx, []*blob.Blob{newBlob}, state.NewTxConfig())
// 	if err != nil {
// 		log.Printf("❌ Submit lỗi: %v", err)
// 		return nil
// 	}

// 	commitmentBase64 := base64.StdEncoding.EncodeToString(newBlob.Commitment)
// 	fmt.Printf("✅ Submit OK! Height: %d\n", height)

// 	// Chờ index
// 	time.Sleep(3 * time.Second)

// 	blockInfo, err := getBlockInfo(height)
// 	if err != nil {
// 		log.Printf("⚠️ Lỗi lấy block info: %v", err)
// 		return nil
// 	}

// 	// --- TÍNH TOÁN TX HASH ---
// 	txHash := ""
// 	txIndex := -1

// 	// Lấy mảng Tx từ Block
// 	txs := blockInfo.Result.Block.Data.Txs
// 	if len(txs) > 0 {
// 		// Giả sử Tx của mình là cái cuối cùng (vì vừa submit xong)
// 		txIndex = len(txs) - 1
// 		txBase64 := txs[txIndex]

// 		// 1. Giải mã Base64 -> Bytes
// 		txBytes, err := base64.StdEncoding.DecodeString(txBase64)
// 		if err == nil {
// 			// 2. Hash SHA-256
// 			hash32 := sha256.Sum256(txBytes)
// 			// 3. Chuyển sang Hex (In hoa)
// 			txHash = strings.ToUpper(hex.EncodeToString(hash32[:]))
// 		}
// 	}

// 	blockTime, _ := time.Parse(time.RFC3339Nano, blockInfo.Result.Block.Header.Time)
// 	timestamp := blockTime.Unix()

// 	blobDetail := BlobDetail{
// 		Height:     height,
// 		Index:      txIndex,
// 		Namespace:  nsBase64,
// 		Commitment: commitmentBase64,
// 		Signer:     "DeFAI Sensor",
// 		Size:       len(data),
// 		Hash:       txHash, // <-- Gán TxHash vào đây
// 		Timestamp:  timestamp,
// 	}

// 	return &BlockResult{
// 		Height:    height,
// 		Timestamp: timestamp,
// 		Index:     0,
// 		Hash:      blockInfo.Result.BlockID.Hash,
// 		Count:     1,
// 		Blobs:     []BlobDetail{blobDetail},
// 	}
// }

// func getBlockInfo(height uint64) (*ConsensusBlockResponse, error) {
// 	url := fmt.Sprintf("%s/block?height=%d", ConsensusURL, height)
// 	resp, err := http.Get(url)
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer resp.Body.Close()

// 	body, err := ioutil.ReadAll(resp.Body)
// 	if err != nil {
// 		return nil, err
// 	}

// 	var data ConsensusBlockResponse
// 	if err := json.Unmarshal(body, &data); err != nil {
// 		return nil, err
// 	}
// 	return &data, nil
// }
