/**
 * Glob Pattern Matching Tests
 * Tests for glob() and recursiveGlob() pattern matching
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';

describe('Glob Pattern Matching', () => {
  let graph: Graph;
  let root: SubnetNode;

  beforeEach(() => {
    graph = new Graph();

    // Create structure:
    // root (subnet)
    //   blur1
    //   blur2
    //   blurFinal
    //   noise1
    //   timer1
    //   effects (subnet)
    //     blur3
    //     glow1
    //     backup_blur
    //   utils (subnet)
    //     timer2
    //     helper1
    root = new SubnetNode('root', graph);
    graph.addElement(root);

    // Root level nodes
    const blur1 = new Node('blur1', 'Blur', graph);
    const blur2 = new Node('blur2', 'Blur', graph);
    const blurFinal = new Node('blurFinal', 'Blur', graph);
    const noise1 = new Node('noise1', 'Noise', graph);
    const timer1 = new Node('timer1', 'Timer', graph);

    root.addChild(blur1);
    root.addChild(blur2);
    root.addChild(blurFinal);
    root.addChild(noise1);
    root.addChild(timer1);

    // Effects subnet
    const effects = new SubnetNode('effects', graph);
    root.addChild(effects);

    const blur3 = new Node('blur3', 'Blur', graph);
    const glow1 = new Node('glow1', 'Glow', graph);
    const backupBlur = new Node('backup_blur', 'Blur', graph);
    effects.addChild(blur3);
    effects.addChild(glow1);
    effects.addChild(backupBlur);

    // Utils subnet
    const utils = new SubnetNode('utils', graph);
    root.addChild(utils);

    const timer2 = new Node('timer2', 'Timer', graph);
    const helper1 = new Node('helper1', 'Helper', graph);
    utils.addChild(timer2);
    utils.addChild(helper1);
  });

  describe('glob() - direct children matching', () => {
    it('should return all children with *', () => {
      const matches = root.glob('*');
      expect(matches).toHaveLength(7); // blur1, blur2, blurFinal, noise1, timer1, effects, utils
    });

    it('should match prefix patterns', () => {
      const matches = root.glob('blur*');
      expect(matches).toHaveLength(3);
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('blur2');
      expect(matches.map(n => n.id)).toContain('blurFinal');
    });

    it('should match suffix patterns', () => {
      const matches = root.glob('*1');
      expect(matches).toHaveLength(3);
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('noise1');
      expect(matches.map(n => n.id)).toContain('timer1');
    });

    it('should match single character with ?', () => {
      const matches = root.glob('blur?');
      expect(matches).toHaveLength(2);
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('blur2');
    });

    it('should match character sets with [abc]', () => {
      const matches = root.glob('blur[12]');
      expect(matches).toHaveLength(2);
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('blur2');
    });

    it('should exclude with ^ prefix', () => {
      const matches = root.glob('* ^blur*');
      expect(matches).toHaveLength(4);
      expect(matches.map(n => n.id)).not.toContain('blur1');
      expect(matches.map(n => n.id)).not.toContain('blur2');
      expect(matches.map(n => n.id)).not.toContain('blurFinal');
    });

    it('should handle multiple excludes', () => {
      const matches = root.glob('* ^blur* ^timer*');
      expect(matches).toHaveLength(3);
      expect(matches.map(n => n.id)).toContain('noise1');
      expect(matches.map(n => n.id)).toContain('effects');
      expect(matches.map(n => n.id)).toContain('utils');
    });

    it('should return empty array for no matches', () => {
      const matches = root.glob('nonexistent*');
      expect(matches).toHaveLength(0);
    });

    it('should match exact names', () => {
      const matches = root.glob('blur1');
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('blur1');
    });

    it('should work on subnet children', () => {
      const effects = root.children().find(n => n.id === 'effects') as SubnetNode;
      const matches = effects.glob('*');
      expect(matches).toHaveLength(3);
    });
  });

  describe('recursiveGlob() - recursive descendant matching', () => {
    it('should return all descendants with **', () => {
      const matches = root.recursiveGlob('**');
      // Root children (7) + effects children (3) + utils children (2) = 12
      expect(matches).toHaveLength(12);
    });

    it('should match pattern at any depth with **/', () => {
      const matches = root.recursiveGlob('**/blur*');
      expect(matches).toHaveLength(4);
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('blur2');
      expect(matches.map(n => n.id)).toContain('blurFinal');
      expect(matches.map(n => n.id)).toContain('blur3');
    });

    it('should match timer* at any depth', () => {
      const matches = root.recursiveGlob('**/timer*');
      expect(matches).toHaveLength(2);
      expect(matches.map(n => n.id)).toContain('timer1');
      expect(matches.map(n => n.id)).toContain('timer2');
    });

    it('should find deep nested nodes', () => {
      // Add a deeply nested node
      const utils = root.children().find(n => n.id === 'utils') as SubnetNode;
      const deepSubnet = new SubnetNode('deep', graph);
      utils.addChild(deepSubnet);

      const deepNode = new Node('blur_deep', 'Blur', graph);
      deepSubnet.addChild(deepNode);

      const matches = root.recursiveGlob('**/blur*');
      expect(matches).toHaveLength(5);
      expect(matches.map(n => n.id)).toContain('blur_deep');
    });

    it('should work with suffix patterns', () => {
      const matches = root.recursiveGlob('**/*1');
      expect(matches).toHaveLength(5);
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('noise1');
      expect(matches.map(n => n.id)).toContain('timer1');
      expect(matches.map(n => n.id)).toContain('glow1');
      expect(matches.map(n => n.id)).toContain('helper1');
    });

    it('should respect excludes in recursive search', () => {
      const matches = root.recursiveGlob('**/blur* ^backup*');
      // Should exclude backup_blur from effects
      expect(matches.map(n => n.id)).not.toContain('backup_blur');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty pattern as match all', () => {
      const matches = root.glob('');
      expect(matches).toHaveLength(7);
    });

    it('should handle pattern with only spaces', () => {
      const matches = root.glob('   ');
      expect(matches).toHaveLength(0);
    });

    it('should handle node with no children', () => {
      const blur1 = root.children().find(n => n.id === 'blur1')!;
      const matches = blur1.glob('*');
      expect(matches).toHaveLength(0);
    });

    it('should handle recursive glob on node with no children', () => {
      const blur1 = root.children().find(n => n.id === 'blur1')!;
      const matches = blur1.recursiveGlob('**');
      expect(matches).toHaveLength(0);
    });

    it('should handle special regex characters in node names', () => {
      const special = new Node('node.test', 'Test', graph);
      root.addChild(special);

      // The pattern should match literally, not as regex
      const matches = root.glob('node.*');
      expect(matches.map(n => n.id)).toContain('node.test');
    });

    it('should handle nodes with underscores', () => {
      const matches = root.recursiveGlob('**/backup*');
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('backup_blur');
    });
  });

  describe('Pattern combinations', () => {
    it('should match middle wildcard', () => {
      const matches = root.glob('blur*al');
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('blurFinal');
    });

    it('should match multiple wildcards', () => {
      // Create a node that matches multiple wildcards
      const testNode = new Node('a_blur_b', 'Test', graph);
      root.addChild(testNode);

      const matches = root.glob('*blur*');
      expect(matches.map(n => n.id)).toContain('blur1');
      expect(matches.map(n => n.id)).toContain('a_blur_b');
    });

    it('should combine ? and *', () => {
      const matches = root.glob('blur?*');
      expect(matches).toHaveLength(3);
    });
  });
});
