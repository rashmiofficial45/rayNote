import { describe, it, expect } from 'vitest';
import {
  getIntersectingBlockIndices,
  findBlockIndexByDocY,
  type CachedBlockRect,
} from '../useBlockDrag';
import { getAllBlocks } from '../BlockSelection';

describe('BlockSelection Geometry & Collision Tests', () => {
  const sampleBlocks: CachedBlockRect[] = [
    { index: 0, pos: 0, nodeSize: 10, docTop: 20, docBottom: 60, docLeft: 40, docRight: 600 },
    { index: 1, pos: 11, nodeSize: 15, docTop: 100, docBottom: 135, docLeft: 40, docRight: 600 },
    { index: 2, pos: 27, nodeSize: 20, docTop: 180, docBottom: 220, docLeft: 40, docRight: 600 },
  ];

  it('1. Empty space 2cm vertical gap click returns null (no false selection)', () => {
    // Gap between block 0 (bottom 60) and block 1 (top 100) at y = 80
    const hit = getIntersectingBlockIndices(sampleBlocks, 80, 80, 10, 10, true);
    expect(hit).toBeNull();
  });

  it('2. Drag 2cm above below content does NOT prematurely select below block (penetration threshold)', () => {
    // Drag starting at 25 and ending at 105 (Block 1 top is 100, threshold is 8px -> 108 required)
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 105, 10, 10, true);
    expect(hit).not.toBeNull();
    expect(hit?.minIdx).toBe(0);
    expect(hit?.maxIdx).toBe(0); // Block 1 is NOT selected!
  });

  it('3. 2D Marquee horizontal isolation: dragging in right empty space isolates blocks', () => {
    // Marquee in vertical range of Block 0 (25..55), but far to the right (x: 650..750)
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 55, 650, 750, false);
    expect(hit).toBeNull();
  });

  it('4. 2D Marquee intersecting both vertically and horizontally selects target block', () => {
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 55, 50, 200, false);
    expect(hit).not.toBeNull();
    expect(hit?.minIdx).toBe(0);
    expect(hit?.maxIdx).toBe(0);
  });

  it('5. Gutter drag selects across multiple blocks cleanly', () => {
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 120, undefined, undefined, true);
    expect(hit).not.toBeNull();
    expect(hit?.minIdx).toBe(0);
    expect(hit?.maxIdx).toBe(1);
  });

  it('6. findBlockIndexByDocY finds the exact containing block', () => {
    expect(findBlockIndexByDocY(sampleBlocks, 40)).toBe(0);
    expect(findBlockIndexByDocY(sampleBlocks, 80)).toBe(-1); // in gap
    expect(findBlockIndexByDocY(sampleBlocks, 110)).toBe(1);
    expect(findBlockIndexByDocY(sampleBlocks, 200)).toBe(2);
    expect(findBlockIndexByDocY(sampleBlocks, 250)).toBe(-1); // below all
  });

  describe('getAllBlocks document structure traversal', () => {
    it('traverses document tree and extracts selectable blocks in order', () => {
      const mockHeading = {
        isBlock: true,
        type: { name: 'heading' },
        nodeSize: 12,
        childCount: 0,
      };
      const mockParagraph = {
        isBlock: true,
        type: { name: 'paragraph' },
        nodeSize: 18,
        childCount: 0,
      };
      const mockItem1 = {
        isBlock: true,
        type: { name: 'listItem' },
        nodeSize: 8,
        childCount: 0,
      };
      const mockItem2 = {
        isBlock: true,
        type: { name: 'listItem' },
        nodeSize: 10,
        childCount: 0,
      };
      const mockBulletList = {
        isBlock: true,
        type: { name: 'bulletList' },
        nodeSize: 20,
        childCount: 2,
        child: (i: number) => [mockItem1, mockItem2][i],
      };

      const doc = {
        childCount: 3,
        child: (i: number) => [mockHeading, mockParagraph, mockBulletList][i],
      } as any;

      const blocks = getAllBlocks(doc);
      expect(blocks.length).toBe(4);
      expect(blocks[0].node.type.name).toBe('heading');
      expect(blocks[0].pos).toBe(0);
      expect(blocks[1].node.type.name).toBe('paragraph');
      expect(blocks[1].pos).toBe(12);
      expect(blocks[2].node.type.name).toBe('listItem');
      expect(blocks[2].pos).toBe(31); // 12 + 18 + 1 (inside list)
      expect(blocks[3].node.type.name).toBe('listItem');
      expect(blocks[3].pos).toBe(39); // 31 + 8
    });
  });
});
