/**
 * Library types for node picker UI
 * These types define the structure of node libraries for the editor
 */

export interface NodeTemplate {
  name: string;
  icon: string;
  description: string;
  type: string;
}

export interface Category {
  id: string;
  label: string;
  nodes: NodeTemplate[];
}

export interface Library {
  id: string;
  label: string;
  icon: string;
  categories: Category[];
}
