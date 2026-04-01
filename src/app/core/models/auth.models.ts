/** Respuesta de GET /api/auth/me/ (Django MeView). */
export interface MeUser {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  cellphone?: string;
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
}

export interface MeResponse {
  user: MeUser;
  profile: MeProfile | null;
}

export interface TokenPair {
  access: string;
  refresh: string;
}
