const base64Data = "Cs0CCqABCp0BCiAvY2VsZXN0aWEuYmxvYi52MS5Nc2dQYXlGb3JCbG9icxJ5Ci9jZWxlc3RpYTFrcWx0c3EyaGtmcHp1Z2plc21nZHhhNmN2cXc2ajdqZnp5em1oNhIdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABzZW5zb3IaAuIBIiA1olg87eJ4UqwFKIrFa4oTrYXou5JedyalZ+R8LQvz+0IBABJmClEKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDgY9H2q9/bRVOKeG6PW0sXZUNxsWiVCtrZnDK1GqML6ASBAoCCAEYhQkSEQoLCgR1dGlhEgMzMjAQtO8EGkDrJ+TAN6RP9ZSpxbYsHkjo2lMEazibeThrxwnSe4kqc3Sqjzrzzi8nUKzbVICzPZs6BRT8tWlSFx1cTgNLZqMcEoMCChwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc2Vuc29yEuIBeyJfaWQiOiIyYzgyYWZlMy05NDczLTRjOGEtOGNjYi02M2MwZTY5MWYzMzFfMDgzNGI0NmMtMDgxMC00ZTllLWFhMTEtNGUyZTc4MWM5OWVhIiwiY3JlYXRlZFRpbWUiOjE3NjU0MjU4ODYsInBvc3RJZCI6IjA4MzRiNDZjLTA4MTAtNGU5ZS1hYTExLTRlMmU3ODFjOTllYSIsInJlYWN0aW9uVHlwZSI6Imxpa2UiLCJ1c2VySWQiOiIyYzgyYWZlMy05NDczLTRjOGEtOGNjYi02M2MwZTY5MWYzMzEifRoEQkxPQg==";

// Giải mã Base64 sang chuỗi UTF-8
const decodedString = Buffer.from(base64Data, 'base64').toString('utf-8');

// Tìm đoạn JSON bên trong (vì Protobuf có chứa các ký tự điều khiển)
const jsonMatch = decodedString.match(/\{".*"\}/);

if (jsonMatch) {
    const depinData = JSON.parse(jsonMatch[0]);
    console.log("✅ Dữ liệu DePIN đã decode:", depinData);
}