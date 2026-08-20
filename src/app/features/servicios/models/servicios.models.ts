/** Estados de maquinaria (API servicios). */
export type MachineStatus = 'ACTIVE' | 'OUT_OF_SERVICE' | 'DECOMMISSIONED';

/** GET/POST/PATCH /api/servicios/machines/ */
export interface Machine {
  id: number;
  company: number | null;
  client: number;
  client_name: string | null;
  brand: number;
  brand_name: string | null;
  model: string;
  serial_number: string;
  plate_image_url: string | null;
  daily_working_hours: number;
  current_hour_meter: number | null;
  location: string;
  status: MachineStatus | string;
  created_at: string | null;
  updated_at: string | null;
}

/** Body de alta/edición (sin `company`: lo asigna el backend). */
export interface MachineWritePayload {
  client: number;
  brand: number;
  model: string;
  serial_number: string;
  plate_image_url?: string | null;
  daily_working_hours: number;
  current_hour_meter?: number | null;
  location: string;
  status: MachineStatus | string;
}

export interface MachineListFilters {
  client_id?: number;
  brand_id?: number;
  status?: string;
}
