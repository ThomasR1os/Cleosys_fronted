/** Respuesta de GET /api/auth/me/ (Django MeView). */
export interface MeUser {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  cellphone?: string;
  /** Si el backend lo expone en `/auth/me/` (superusuario Django). */
  is_superuser?: boolean;
}

export interface MeCompany {
  id: number;
  name: string;
}

export interface MeProfile {
  id: number;
  role: string;
  quotation_prefix?: string;
  company: MeCompany;
  user?: MeUser;
  /** Reply-To del correo al enviar cotizaciones; si vacío, el backend usa user.email. */
  reply_to_email?: string | null;
  /** Nombre visible en el correo (From / display). */
  email_display_name?: string | null;
  /** URL Cloudinary de la firma (solo lectura; subir/borrar vía /auth/me/signature/). */
  signature_url?: string | null;
}

export interface MeResponse {
  user: MeUser;
  profile: MeProfile | null;
}

/** PATCH /api/auth/me/ — preferencias de correo del asesor. */
export interface MePatchRequest {
  profile?: {
    reply_to_email?: string | null;
    email_display_name?: string | null;
    quotation_prefix?: string | null;
  };
}

export interface TokenPair {
  access: string;
  refresh: string;
}
