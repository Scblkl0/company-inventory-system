import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:3000/api';
  constructor(private http: HttpClient) {}
  get(path: string) { return this.http.get<any>(`${this.base}/${path}`, { withCredentials: true }); }
  post(path: string, body: any) { return this.http.post<any>(`${this.base}/${path}`, body, { withCredentials: true }); }
  put(path: string, body: any) { return this.http.put<any>(`${this.base}/${path}`, body, { withCredentials: true }); }
  delete(path: string) { return this.http.delete(`${this.base}/${path}`, { withCredentials: true }); }
}
