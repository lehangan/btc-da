// Chuỗi Base64 từ block Celestia
const txBase64 = "Cs0CCqABCp0BCiAvY2VsZXN0aWEuYmxvYi52MS5Nc2dQYXlGb3JCbG9icxJ5Ci9jZWxlc3RpYTFrcWx0c3EyaGtmcHp1Z2plc21nZHhhNmN2cXc2ajdqZnp5em1oNhIdAAAAAAAAAAAAAAAAAAAAAAAAAABkZWZTZW5zb3IaAuIBIiC+8nF+AFgLNidAjgGrBz+ATncXdL99Qq+OAn5u/KU6eUIBABJmClEKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDgY9H2q9/bRVOKeG6PW0sXZUNxsWiVCtrZnDK1GqML6ASBAoCCAEY3AQSEQoLCgR1dGlhEgMzMjAQtO8EGkDryLvZljIs4UStGBzML4jd2gpSTvX8QthdTj/6lxuU/05Dxd4nQbzY7A7YQv4rjOFsKPhKEFPYL0v/N9iYodoQEoMCChwAAAAAAAAAAAAAAAAAAAAAAAAAZGVmU2Vuc29yEuIBeyJfaWQiOiIwODdmMTg3Ni1jMThkLTQ1MjYtODkwMy03YWRiZGUwZWQxY2VfODJlNTBkMjQtY2VhMS00MjZmLTliYTktYmE4ZDVmZmFlMjhhIiwiY3JlYXRlZFRpbWUiOjE3NjMwMTU4MzcsInBvc3RJZCI6IjgyZTUwZDI0LWNlYTEtNDI2Zi05YmE5LWJhOGQ1ZmZhZTI4YSIsInJlYWN0aW9uVHlwZSI6Imxpa2UiLCJ1c2VySWQiOiIwODdmMTg3Ni1jMThkLTQ1MjYtODkwMy03YWRiZGUwZWQxY2UifRoEQkxPQg=="
function decodeCelestiaTx(base64String) {
    // 1. Chuyển từ Base64 sang Buffer
    const buffer = Buffer.from(base64String, 'base64');
    
    // 2. Chuyển sang chuỗi UTF-8 (lúc này sẽ lẫn lộn ký tự lạ)
    const rawString = buffer.toString('utf-8');

    console.log("🔍 Đang tìm kiếm JSON trong Transaction...");

    // 3. Dùng mẹo: Tìm dấu ngoặc nhọn đầu tiên '{' và cuối cùng '}'
    // (Cách này hoạt động tốt vì payload của bạn là JSON thuần)
    const startIndex = rawString.indexOf('{');
    const endIndex = rawString.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1) {
        // Cắt lấy đúng phần JSON
        const jsonString = rawString.substring(startIndex, endIndex + 1);
        
        try {
            // 4. Format lại cho đẹp
            const jsonObj = JSON.parse(jsonString);
            console.log("\n✅ DỮ LIỆU ĐÃ GIẢI MÃ THÀNH CÔNG:\n");
            console.log(JSON.stringify(jsonObj, null, 2));
            return jsonObj;
        } catch (e) {
            console.error("❌ Tìm thấy chuỗi giống JSON nhưng parse lỗi:", e);
        }
    } else {
        console.error("❌ Không tìm thấy cấu trúc JSON trong chuỗi này.");
    }
}

decodeCelestiaTx(txBase64);