import type { ApiSuccess, LoginResponse } from '@/types/api';
import { http } from './http';

export const authApi = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const { data } = await http.post<ApiSuccess<LoginResponse>>('/auth/login', { username, password });
    return data.data;
  },
};
