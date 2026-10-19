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
  /** Nombre de categoría si el API lo envía anidado (solo lectura / UI). */
  category_name?: string | null;
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
  /** Garantía del producto. */
  warranty: string | null;
  /**
   * Días de espera estimados. `null` = todavía no hay plazo.
   * `0` = entrega inmediata.
   */
  estimated_lead_time_days: number | null;
  /**
   * Compatibilidad con respuestas antiguas / Excel.
   * (En algunos entornos el backend expone el typo `warrannty`.)
   */
  warrannty?: string | null;
  status: string;
  dimensions: string | null;
  gross_weight: string | null;
  /** Fecha de alta (ISO; solo lectura). */
  creation_date?: string | null;
  /** Fecha de última modificación (ISO; solo lectura). */
  update_date?: string | null;
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
  /** Ubicación dentro del almacén. */
  location: string;
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
  /** Nota libre. Vacía llega como `null`. */
  observation: string | null;
  creation_date?: string;
}

/** Alta manual. `cant` va como decimal en texto (`"1.00"`). Sin nota, se omite `observation`. */
export interface WarehouseMovementWrite {
  warehouse: number;
  product: number;
  movement_type: MovementType;
  cant: string;
  observation?: string | null;
}

export interface WarehouseMovementImportError {
  row: number;
  error: string;
}

export interface WarehouseMovementImportResult {
  created: number;
  failed: number;
  errors: WarehouseMovementImportError[];
}
