/** Claves de `CATALOG_REGISTRY` y valor en `route.data.catalogKey`. */
export type CatalogRegistryKey =
  | 'brands'
  | 'categories'
  | 'subcategories'
  | 'types'
  | 'units'
  | 'payment-methods';

export type CatalogFieldType = 'text' | 'number' | 'textarea' | 'select';

export interface CatalogFormField {
  key: string;
  label: string;
  type: CatalogFieldType;
  required?: boolean;
  /** Para `select`: segmento bajo `/api/`, p. ej. `categories`. */
  optionsFrom?: string;
}

export interface CatalogListColumn {
  key: string;
  label: string;
}

export interface CatalogDefinition {
  title: string;
  description: string;
  apiPath: string;
  listColumns: CatalogListColumn[];
  /** Campos del formulario (sin `id`: el alta opcional de id lo gestiona `SimpleCatalogPageComponent`). */
  formFields: CatalogFormField[];
}

export const CATALOG_REGISTRY: Record<CatalogRegistryKey, CatalogDefinition> = {
  brands: {
    title: 'Marcas',
    description: 'Marcas de producto (catálogo compartido).',
    apiPath: 'brands',
    listColumns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nombre' },
    ],
    formFields: [{ key: 'name', label: 'Nombre', type: 'text', required: true }],
  },
  categories: {
    title: 'Categorías',
    description: 'Categorías de producto.',
    apiPath: 'categories',
    listColumns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nombre' },
    ],
    formFields: [{ key: 'name', label: 'Nombre', type: 'text', required: true }],
  },
  subcategories: {
    title: 'Subcategorías',
    description: 'Subcategorías ligadas a una categoría.',
    apiPath: 'subcategories',
    listColumns: [
      { key: 'id', label: 'ID' },
      { key: 'category', label: 'Categoría (ID)' },
      { key: 'name', label: 'Nombre' },
    ],
    formFields: [
      {
        key: 'category',
        label: 'Categoría',
        type: 'select',
        required: true,
        optionsFrom: 'categories',
      },
      { key: 'name', label: 'Nombre', type: 'text', required: true },
    ],
  },
  types: {
    title: 'Tipos de producto',
    description: 'Tipos de producto del catálogo.',
    apiPath: 'types',
    listColumns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nombre' },
    ],
    formFields: [{ key: 'name', label: 'Nombre', type: 'text', required: true }],
  },
  units: {
    title: 'Unidades de medida',
    description: 'Unidades y abreviatura.',
    apiPath: 'units',
    listColumns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nombre' },
      { key: 'abreviation', label: 'Abrev.' },
    ],
    formFields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true },
      { key: 'abreviation', label: 'Abreviatura', type: 'text', required: true },
    ],
  },
  'payment-methods': {
    title: 'Métodos de pago',
    description: 'Formas de pago disponibles.',
    apiPath: 'payment-methods',
    listColumns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Nombre' },
    ],
    formFields: [{ key: 'name', label: 'Nombre', type: 'text', required: true }],
  },
};
