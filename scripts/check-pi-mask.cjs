const test = require('node:test');
const assert = require('node:assert/strict');
const {scan} = require('../dist/pi-mask');

test('nested JSON retains exact diagnostic numbers and handles repeated personal data', () => {
  const input = '{"count":90071992547409991,"firstName":"Demo","firstName":"Demo","headers":{"authorization":"Bearer example"},"unknown":[{"phone":"1234567890"}]}';
  assert.equal(scan(input).text, '{"count":90071992547409991,"firstName":"[PERSON_1]","firstName":"[PERSON_1]","headers":{"authorization":"[SECRET_1]"},"unknown":[{"phone":"[PHONE_1]"}]}');
});

test('learned field masks future opaque values and structured data', () => {
  const suggested = scan('{"replyChannel":"mock@example.test"}', {learn:true});
  assert.deepEqual(suggested.suggestions,['replyChannel']);
  assert.deepEqual(scan('{"replyChannel":"mock@example.test"}').suggestions,[]);
  const opts = {fields:suggested.suggestions};
  assert.equal(scan('replyChannel=private-alias status=502', opts).text,'replyChannel=[CUSTOM_1] status=502');
  assert.equal(scan('{"replyChannel":{"private":"alias"},"status":502}',opts).text,'{"replyChannel":"[CUSTOM_1]","status":502}');
});

test('respects disabled categories and masks complete headers, embedded JSON and free text', () => {
  assert.equal(scan('email=demo@example.test', {disabled:['EMAIL']}).text,'email=demo@example.test');
  assert.equal(scan('Cookie: sid=abc; other=xyz\nstatus=401').text,'Cookie: [SECRET_1]\nstatus=401');
  assert.equal(scan('WARN body={"address":["x","y"],"code":"ERR_400"}').text,'WARN body={"address":"[ADDRESS_1]","code":"ERR_400"}');
  assert.equal(scan('reply to mock@example.test about 123-45-6789').text,'reply to [EMAIL_1] about [ID_1]');
  const nested = JSON.stringify({body:JSON.stringify({password:'abc'})});
  assert.equal(JSON.parse(JSON.parse(scan(nested).text).body).password,'[SECRET_1]');
});
