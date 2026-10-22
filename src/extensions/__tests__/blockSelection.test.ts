import { describe, it, expect } from 'vitest';
import {
  getIntersectingBlockIndices,
  findBlockIndexByDocY,
  rectsIntersect,
  getBlockContentRects,
  type CachedBlockRect,
} from '../useBlockDrag';
import { getAllBlocks } from '../BlockSelection';
import { calculateAutoScrollSpeed } from '../useAutoScroll';
import {
  registerClick,
  findVisualLineRange,
  findParagraphRange,
} from '../../editor/clickSelectionExtension';

describe('BlockSelection Geometry & Collision Tests', () => {
  const sampleBlocks: CachedBlockRect[] = [
    {
      index: 0,
      pos: 0,
      nodeSize: 10,
      docTop: 20,
      docBottom: 60,
      docLeft: 40,
      docRight: 600,
      contentRects: [{ left: 40, right: 250, top: 20, bottom: 60 }],
    },
    {
      index: 1,
      pos: 11,
      nodeSize: 15,
      docTop: 100,
      docBottom: 135,
      docLeft: 40,
      docRight: 600,
      contentRects: [{ left: 40, right: 350, top: 100, bottom: 135 }],
    },
    {
      index: 2,
      pos: 27,
      nodeSize: 20,
      docTop: 180,
      docBottom: 220,
      docLeft: 40,
      docRight: 600,
      contentRects: [{ left: 40, right: 200, top: 180, bottom: 220 }],
    },
  ];

  it('1. Empty space vertical gap click returns null (no false selection)', () => {
    // Gap between block 0 (bottom 60) and block 1 (top 100) at y = 80
    const hit = getIntersectingBlockIndices(sampleBlocks, 80, 80, 10, 10);
    expect(hit).toBeNull();
  });

  it('2. Drag above below content does NOT prematurely select below block (penetration threshold)', () => {
    // Drag starting at 25 and ending at 105 across Block 0's text (Block 1 top is 100, threshold is 8px -> 108 required)
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 105, 10, 100);
    expect(hit).not.toBeNull();
    expect(hit?.minIdx).toBe(0);
    expect(hit?.maxIdx).toBe(0); // Block 1 is NOT selected!
  });

  it('3. Dragging in right empty margin only selects NOTHING', () => {
    // Marquee in vertical range of Block 0 (25..55), but far to the right in margin (x: 350..550, text ends at 250)
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 55, 350, 550);
    expect(hit).toBeNull();
  });

  it('4. Dragging in left empty margin only selects NOTHING', () => {
    // Rubber band completely inside left margin (x: 5..35, text starts at 40)
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 55, 5, 35);
    expect(hit).toBeNull();
  });

  it('5. Drag from left margin across half a line selects ONLY that block', () => {
    // Starts at x: 10 (left margin) and ends at x: 150 (inside Block 0's text [40..250])
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 55, 10, 150);
    expect(hit).not.toBeNull();
    expect(hit?.minIdx).toBe(0);
    expect(hit?.maxIdx).toBe(0);
    expect(hit?.selectedIndices).toEqual([0]);
  });

  it('6. Drag spanning across multiple blocks selects them cleanly', () => {
    // Drag from 25 to 125 across Block 0 and penetrating Block 1
    const hit = getIntersectingBlockIndices(sampleBlocks, 25, 125, 10, 200);
    expect(hit).not.toBeNull();
    expect(hit?.minIdx).toBe(0);
    expect(hit?.maxIdx).toBe(1);
    expect(hit?.selectedIndices).toEqual([0, 1]);
  });

  it('7. findBlockIndexByDocY finds the exact containing block', () => {
    expect(findBlockIndexByDocY(sampleBlocks, 40)).toBe(0);
    expect(findBlockIndexByDocY(sampleBlocks, 80)).toBe(-1); // in gap
    expect(findBlockIndexByDocY(sampleBlocks, 110)).toBe(1);
    expect(findBlockIndexByDocY(sampleBlocks, 200)).toBe(2);
    expect(findBlockIndexByDocY(sampleBlocks, 250)).toBe(-1); // below all
  });

  it('8. rectsIntersect correctly validates 2D box collisions with 0px tolerance', () => {
    // Overlapping boxes
    expect(rectsIntersect(0, 100, 0, 50, 50, 150, 25, 75, 0)).toBe(true);
    // Non-overlapping horizontally (margin gap)
    expect(rectsIntersect(300, 400, 0, 50, 50, 250, 0, 50, 0)).toBe(false);
    // Non-overlapping vertically
    expect(rectsIntersect(0, 100, 0, 50, 0, 100, 60, 100, 0)).toBe(false);
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
      expect(blocks[2].pos).toBe(31);
      expect(blocks[3].node.type.name).toBe('listItem');
      expect(blocks[3].pos).toBe(39);
    });
  });

  describe('ClickSelection Click Counter & Line Range Logic', () => {
    it('tracks single, double, triple, and quadruple clicks within 400ms and 4px', () => {
      const tracker = { lastClickTime: 0, lastClickX: 0, lastClickY: 0, count: 0 };

      // First click
      expect(registerClick(100, 200, 1000, tracker)).toBe(1);
      // Double click (200ms later, 2px away)
      expect(registerClick(101, 201, 1200, tracker)).toBe(2);
      // Triple click (150ms later, 1px away)
      expect(registerClick(101, 201, 1350, tracker)).toBe(3);
      // Quadruple click (100ms later, 1px away)
      expect(registerClick(100, 200, 1450, tracker)).toBe(4);
      // 5th click (stays >= 4, does not wrap around)
      expect(registerClick(100, 200, 1550, tracker)).toBe(5);

      // Distant click (>4px away) resets counter
      expect(registerClick(150, 250, 1600, tracker)).toBe(1);

      // Delayed click (>400ms later) resets counter
      expect(registerClick(150, 250, 2100, tracker)).toBe(1);
    });

    it('findVisualLineRange splits on newlines inside code blocks', () => {
      const codeText = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);';
      const mockCodeBlockNode = {
        type: { name: 'codeBlock' },
        textContent: codeText,
      };

      const mockDoc = {
        content: { size: 100 },
        resolve: (_pos: number) => ({
          depth: 1,
          node: (_d: number) => mockCodeBlockNode,
          start: (_d: number) => 1,
          end: (_d: number) => 1 + codeText.length,
        }),
      };

      const mockView = {
        state: { doc: mockDoc },
        coordsAtPos: () => ({ top: 10, bottom: 30, left: 0, right: 100 }),
      } as any;

      // Click on line 2 ('const b = 2;', pos = 1 + 13 + 3 = 17)
      const range = findVisualLineRange(mockView, 17);
      // Line 2 starts at 1 + 13 = 14 and ends at 1 + 25 = 26
      expect(range.from).toBe(14);
      expect(range.to).toBe(26);
    });

    it('findParagraphRange selects the full textblock bounds', () => {
      const mockParagraph = {
        isTextblock: true,
        type: { name: 'paragraph' },
      };

      const mockDoc = {
        content: { size: 100 },
        resolve: (_pos: number) => ({
          depth: 1,
          node: (_d: number) => mockParagraph,
          start: (_d: number) => 5,
          end: (_d: number) => 45,
        }),
      };

      const mockView = {
        state: { doc: mockDoc },
      } as any;

      const range = findParagraphRange(mockView, 20);
      expect(range.from).toBe(5);
      expect(range.to).toBe(45);
    });
  });

  describe('Code Block Selection & Geometry', () => {
    it('getBlockContentRects classifies pre elements as non-text blocks and uses element bounds', () => {
      const preEl = {
        tagName: 'PRE',
        classList: {
          contains: (cls: string) => cls === 'code-block-wrapper' || cls === 'notefast-code-block',
        },
        querySelector: () => null,
        getBoundingClientRect: () => ({
          left: 40,
          right: 640,
          top: 100,
          bottom: 250,
          width: 600,
          height: 150,
          x: 40,
          y: 100,
        }),
      } as any;

      const containerRect = {
        left: 0,
        top: 0,
        right: 800,
        bottom: 1000,
        width: 800,
        height: 1000,
        x: 0,
        y: 0,
      } as any;

      const rects = getBlockContentRects(preEl, containerRect, 0);
      expect(rects.length).toBe(1);
      expect(rects[0].left).toBe(40);
      expect(rects[0].right).toBe(640);
      expect(rects[0].top).toBe(100);
      expect(rects[0].bottom).toBe(250);
    });

    it('Dragging from outside left margin across a code block correctly selects it', () => {
      const codeBlock: CachedBlockRect = {
        index: 0,
        pos: 0,
        nodeSize: 50,
        docTop: 100,
        docBottom: 250,
        docLeft: 40,
        docRight: 640,
        contentRects: [{ left: 40, right: 640, top: 100, bottom: 250 }],
      };

      // Drag starts outside at x: 10 (margin) and extends into the code block at x: 120
      // Vertically covering docTop 100..250 (e.g. 110..220)
      const hit = getIntersectingBlockIndices([codeBlock], 110, 220, 10, 120);
      expect(hit).not.toBeNull();
      expect(hit?.selectedIndices).toEqual([0]);
    });
  });

  describe('Auto-Scroll Velocity & Boundary Tests', () => {
    function createMockContainer(scrollTop: number, scrollHeight: number, clientHeight: number) {
      return {
        scrollTop,
        scrollHeight,
        clientHeight,
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 500,
          left: 0,
          right: 800,
          width: 800,
          height: 400,
        }),
      } as unknown as HTMLElement;
    }

    it('returns 0 speed when cursor is in the neutral center of the viewport', () => {
      // Container bounds: top 100, bottom 500, height 400. Center is 300.
      const container = createMockContainer(150, 1000, 400);
      const speed = calculateAutoScrollSpeed(300, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed).toBe(0);
    });

    it('returns 0 upward scroll speed if container is already at scrollTop = 0', () => {
      // In top zone (y = 120 < topEdge 160), but already at top (scrollTop = 0)
      const container = createMockContainer(0, 1000, 400);
      const speed = calculateAutoScrollSpeed(120, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed).toBe(0);
    });

    it('ramps upward scroll speed quadratically as pointer nears the top edge', () => {
      // Container top is 100, zoneSize is 60 -> topEdge is 160.
      const container = createMockContainer(200, 1000, 400);

      // Mild penetration: y = 145 (depth 15 / 60 = 0.25 -> 0.0625 * 18 ≈ 1)
      const speed1 = calculateAutoScrollSpeed(145, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed1).toBeLessThan(0); // Upward

      // Deep penetration: y = 100 (depth 60 / 60 = 1.0 -> 1.0 * 18 = 18)
      const speed2 = calculateAutoScrollSpeed(100, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed2).toBe(-18);

      expect(Math.abs(speed2)).toBeGreaterThan(Math.abs(speed1));
    });

    it('returns 0 downward scroll speed if container is already at max scroll', () => {
      // maxScroll = scrollHeight (1000) - clientHeight (400) = 600
      const container = createMockContainer(600, 1000, 400);
      // In bottom zone (y = 480 > bottomEdge 440)
      const speed = calculateAutoScrollSpeed(480, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed).toBe(0);
    });

    it('ramps downward scroll speed quadratically as pointer nears the bottom edge', () => {
      // bottom is 500, zoneSize 60 -> bottomEdge is 440
      const container = createMockContainer(100, 1000, 400);

      // Mild penetration: y = 455
      const speed1 = calculateAutoScrollSpeed(455, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed1).toBeGreaterThan(0); // Downward

      // Deep penetration: y = 500 (depth 60 / 60 = 1.0 -> 18)
      const speed2 = calculateAutoScrollSpeed(500, container, { zoneSize: 60, maxSpeed: 18 });
      expect(speed2).toBe(18);

      expect(speed2).toBeGreaterThan(speed1);
    });
  });
});


