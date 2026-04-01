export interface Warehouse {
  id: number;
  supplier: number;
  address: string;
}

/** Maestro de producto (`/api/almacen/products/`). */
export interface Product {
  id: number;
  sku: string;
  description: string;
  category: number | null;
  subcategory: number | null;
  /** FK tipo de producto (maestro `types`). */
  type: number | null;
  brand: number | null;
  unit_measurement: number | null;
  datasheet: string | null;
  /** Precios monetarios (Decimal en API; en front como number). */
  price: number | null;
  rental_price_without_operator: number | null;
  rental_price_with_operator: number | null;
  /** Nombre de campo tal cual en el backend. */
  warrannty: string | null;
  status: string;
  dimensions: string | null;
  gross_weight: string | null;
}

/** Imagen de producto (`/api/almacen/product-images/`). */
export interface ProductImage {
  id: number;
  product: number;
  name: string;
  url: string;
  primary: boolean;
}

export interface WarehouseProduct {
  id: number;
  warehouse: number;
  product: number;
  stock: number;
  ubication: string;
  creation_date?: string;
}

/** Listado ligero de productos (almacén). */
export interface AlmacenProduct {
  id: number;
  sku: string;
  description: string;
}

export type MovementType = 'ENTRADA' | 'SALIDA';

export interface WarehouseMovement {
  id: number;
  warehouse: number;
  product: number;
  cant: string;
  movement_type: MovementType;
  observation: number;
  creation_date?: string;
}
