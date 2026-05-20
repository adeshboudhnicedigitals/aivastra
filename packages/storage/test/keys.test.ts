import { describe, it, expect } from 'vitest';
import { keys } from '../src/keys';

describe('keys', () => {
  it('builds input garment key', () => {
    expect(keys.inputGarment('abc-123')).toBe('inputs/abc-123/garment.jpg');
  });
  it('builds output result key', () => {
    expect(keys.output('abc-123')).toBe('outputs/abc-123/result.png');
  });
  it('builds catalog item key with type and id', () => {
    expect(keys.catalogItem('models', 'uuid-1')).toBe('catalog/models/uuid-1.jpg');
  });
  it('builds catalog thumb key', () => {
    expect(keys.catalogThumb('poses', 'uuid-2')).toBe('catalog/poses/uuid-2.thumb.jpg');
  });
  it('builds model face key', () => {
    expect(keys.modelFace('uuid-1')).toBe('models/faces/uuid-1.jpg');
  });
  it('builds model face thumb key', () => {
    expect(keys.modelFaceThumb('uuid-1')).toBe('models/faces/uuid-1.thumb.jpg');
  });
  it('builds model background key', () => {
    expect(keys.modelBackground('uuid-1')).toBe('models/backgrounds/uuid-1.jpg');
  });
  it('builds model background thumb key', () => {
    expect(keys.modelBackgroundThumb('uuid-1')).toBe('models/backgrounds/uuid-1.thumb.jpg');
  });
  it('builds model pose key', () => {
    expect(keys.modelPose('uuid-1')).toBe('models/poses/uuid-1.jpg');
  });
  it('builds model pose thumb key', () => {
    expect(keys.modelPoseThumb('uuid-1')).toBe('models/poses/uuid-1.thumb.jpg');
  });
});
