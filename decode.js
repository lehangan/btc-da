// Chuỗi Base64 từ block Celestia

const txBase64 = "Cs0CCqABCp0BCiAvY2VsZXN0aWEuYmxvYi52MS5Nc2dQYXlGb3JCbG9icxJ5Ci9jZWxlc3RpYTFrcWx0c3EyaGtmcHp1Z2plc21nZHhhNmN2cXc2ajdqZnp5em1oNhIdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABzZW5zb3IaAuIBIiCzU0pP9Wl9DTgc71AOvyE+7Xs2PV0vfCwGeRGTTsE0TkIBABJmClEKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDgY9H2q9/bRVOKeG6PW0sXZUNxsWiVCtrZnDK1GqML6ASBAoCCAEY+AgSEQoLCgR1dGlhEgMzMjAQtO8EGkBOaIvFhjj7DteRs2FqVV+qZl+FOfppK3BbXmPDv/LypUKh0UWty4YBTNNZenxNzPgR6Osvf/SNA77u73YFASoYEoMCChwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc2Vuc29yEuIBeyJfaWQiOiI2ZWFlZDM4OS1hZTdhLTRhNjUtYmY1NC04YWY5Y2IwMzNmMmFfZGZlZWJlNjMtNGRlZC00YjA5LWE4M2QtM2VhZjQ3NDhjZTJiIiwiY3JlYXRlZFRpbWUiOjE3NjUxNzU5MDgsInBvc3RJZCI6ImRmZWViZTYzLTRkZWQtNGIwOS1hODNkLTNlYWY0NzQ4Y2UyYiIsInJlYWN0aW9uVHlwZSI6Imxpa2UiLCJ1c2VySWQiOiI2ZWFlZDM4OS1hZTdhLTRhNjUtYmY1NC04YWY5Y2IwMzNmMmEifRoEQkxPQg=="
// const txBase64 = "eyJfaWQiOiJkN2FlYjhjYi0zYTkzLTRhZTktYjcxMy0xMWUyYzUyYWQ1YjJfMTNiN2VkNjgtYjA4Mi00ZjViLTkxMzUtMDQ1YzlhYmJjM2E4IiwiY3JlYXRlZFRpbWUiOjE3NjUxODAyNDcsInBvc3RJZCI6IjEzYjdlZDY4LWIwODItNGY1Yi05MTM1LTA0NWM5YWJiYzNhOCIsInJlYWN0aW9uVHlwZSI6Imxpa2UiLCJ1c2VySWQiOiJkN2FlYjhjYi0zYTkzLTRhZTktYjcxMy0xMWUyYzUyYWQ1YjIifQ=="
// const txBase64 = "eyJfaWQiOiI2ZWFlZDM4OS1hZTdhLTRhNjUtYmY1NC04YWY5Y2IwMzNmMmFfYjhmODAwNmQtMTY4Yi00MTk1LWExOWEtNmE1YWZhMWQ5NDMyIiwiY3JlYXRlZFRpbWUiOjE3NjUxNzU5MDUsInBvc3RJZCI6ImI4ZjgwMDZkLTE2OGItNDE5NS1hMTlhLTZhNWFmYTFkOTQzMiIsInJlYWN0aW9uVHlwZSI6Imxpa2UiLCJ1c2VySWQiOiI2ZWFlZDM4OS1hZTdhLTRhNjUtYmY1NC04YWY5Y2IwMzNmMmEifQ=="
function decodeCelestiaTx(base64String) {
    // 1. Chuyển từ Base64 sang Buffer
    const buffer = Buffer.from(base64String, 'base64');
    
    // 2. Chuyển sang chuỗi UTF-8 (lúc này sẽ lẫn lộn ký tự lạ)
    const rawString = buffer.toString('utf-8');

    // console.log("🔍 Đang tìm kiếm JSON trong Transaction...");

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