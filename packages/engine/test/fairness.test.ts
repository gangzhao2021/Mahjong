import { describe, expect, it } from 'vitest';
import { dealCommitment, sha256Hex, verifyDeal } from '../src';

// Reference digests from Node's crypto module.
const VECTORS: [string, string][] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['1234567:5f2a9c', 'f93fa3bc4f589ab884fbc592bfdef93d7ac85765d8f5cced3e7a37618aae9e63'],
  ['血战到底', '8f1d770b453adcdf727f1ce932b85199cfe6fbd242d947c24d1e5df26097039e'],
  ['x'.repeat(55), 'd5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072'],
  ['y'.repeat(56), '4877e564e5e36e367c7c8d59670774becd3350610b6df4c399c9fa9b66da5813'],
  ['z'.repeat(200), '983a71da81783dfb18f7617e411156a9b2655f48a769a001b7f88d4dfee2cb7b'],
  ['🀄 mahjong', '90d58acec761d035b089b0d5fb45743da69d52e20e6d8a61cb30aebba1449ace'],
];

describe('verifiable deals', () => {
  it.each(VECTORS)('sha256(%j)', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });

  it('checks a revealed seed and salt against the commitment', () => {
    const commit = dealCommitment(42, 'abc');
    expect(verifyDeal(commit, 42, 'abc')).toBe(true);
    expect(verifyDeal(commit, 43, 'abc')).toBe(false);
    expect(verifyDeal(commit, 42, 'abd')).toBe(false);
  });
});
