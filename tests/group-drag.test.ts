import { describe, expect, it } from 'vitest';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';
import { Graph } from '@/nodes/Graph';
import { captureGroupDrag, moveGroupDrag, findDropGroup } from '@/editor/groupDrag';

function fixture() {
  const graph = new Graph();
  const node = graph.addNode('Null', {x: 40, y: 60});
  graph.addAnnotation({id:'outer',type:'Group',position:{x:0,y:0},size:{width:500,height:400},containedElements:['inner',node.id]} as any);
  graph.addAnnotation({id:'inner',type:'Group',position:{x:20,y:40},size:{width:240,height:220},containedElements:[node.id,'line']} as any);
  graph.addAnnotation({id:'line',type:'Line',position:{x:50,y:80},endPosition:{x:100,y:120}} as any);
  return {graph,node};
}
describe('canvas group dragging', () => {
  it('moves owned nodes and annotations once, preserving identity and repeat-drag offsets', () => {
    const {graph,node}=fixture(); const line=graph.getAnnotation('line') as any;
    const drag=captureGroupDrag(graph,['outer',node.id]);
    expect(drag.roots).toEqual(['outer']);
    moveGroupDrag(graph,drag,{x:30,y:15});
    moveGroupDrag(graph,drag,{x:60,y:20});
    expect(node.position).toEqual({x:100,y:80});
    expect(graph.getAnnotation('inner')?.position).toEqual({x:80,y:60});
    expect(graph.getAnnotation('line')).toBe(line);
    expect(line.endPosition).toEqual({x:160,y:140});
    moveGroupDrag(graph,captureGroupDrag(graph,['outer']),{x:-10,y:5});
    expect(node.position).toEqual({x:90,y:85});
    expect(line.endPosition).toEqual({x:150,y:145});
  });
  it('prefers the smallest containing group and excludes everything in the moving set', () => {
    const {graph,node}=fixture();
    expect(findDropGroup(graph,node.id,{x:100,y:100},new Set([node.id]))).toBe('inner');
    expect(findDropGroup(graph,node.id,{x:450,y:350},new Set([node.id]))).toBe('outer');
    expect(findDropGroup(graph,node.id,{x:700,y:350},new Set([node.id]))).toBeNull();
    const drag=captureGroupDrag(graph,['outer']);
    expect(findDropGroup(graph,'outer',{x:100,y:100},new Set(drag.items.map(i=>i.id)))).toBeNull();
  });
  it('does not treat another subnet’s group as a drop target', () => {
    const {graph,node}=fixture();
    const subnet=new SubnetNode('subnet',graph);
    graph.addElement(subnet);
    expect(graph.reparentElement(graph.getAnnotation('inner')!,subnet)).toBe(true);
    expect(findDropGroup(graph,node.id,{x:100,y:100},new Set([node.id]))).toBe('outer');
  });
  it('translates polyline points from the drag start without accumulating deltas', () => {
    const graph=new Graph();
    graph.addAnnotation({id:'path',type:'Polyline',position:{x:0,y:0},points:[{x:0,y:0},{x:50,y:80}]} as any);
    const drag=captureGroupDrag(graph,['path']);
    moveGroupDrag(graph,drag,{x:10,y:10}); moveGroupDrag(graph,drag,{x:20,y:10});
    expect((graph.getAnnotation('path') as any).points).toEqual([{x:20,y:10},{x:70,y:90}]);
  });
});
