// input: injected UIAuth examples; output: expiry/parser checks; pos: automatic authorization tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authExpiry, pageAuth } from './thunder-auth.ts';

const token = (exp: number) => `e30.${Buffer.from(JSON.stringify({ key: 'UIAuth', exp })).toString('base64url')}.signature`;
test('读取迅雷注入的 token，支持单引号和换行', () => {
  const jwt = token(2000);
  assert.equal(pageAuth(`<script>function uiauth(value){ return "${jwt}" }</script>`, 1000), jwt);
  assert.equal(pageAuth(`function uiauth(value) {\n return '${jwt}' }`, 1000), jwt);
  assert.equal(authExpiry(jwt), 2_000_000);
});
test('拒绝缺失、坏结构和已过期的本机授权', () => {
  assert.equal(authExpiry('bad-token'), null);
  assert.throws(() => pageAuth('<html>login</html>'), /没有提供/);
  assert.throws(() => pageAuth(`function uiauth(value){return "${token(1)}"}`, 2000), /已过期/);
});
