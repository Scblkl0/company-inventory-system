import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';

type Page = 'dashboard' | 'assets' | 'employees' | 'categories' | 'locations' | 'history' | 'users' | 'profile';
@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent implements OnInit {
  page: Page = 'dashboard'; user: any; error = ''; message = '';
  login = { username: 'admin', password: 'admin123' }; dashboard: any = {};
  assets: any[] = []; employees: any[] = []; categories: any[] = []; locations: any[] = []; history: any[] = []; users: any[] = [];
  asset: any = this.emptyAsset(); item: any = {}; editingId: number | null = null;
  profile: any = { assets: [] }; passwordForm = { current_password: '', new_password: '', repeat_password: '' };
  assignmentEmployee: Record<number, number | null> = {};
  accountResult: any = null;
  historyFilter = { asset_id: null as number | null, action: '', date_from: '', date_to: '', search: '' };
  historyQuery = '';
  constructor(private api: ApiService) {}
  get isAdmin() { return this.user?.role === 'admin'; }
  get historyActions() { return [...new Set(this.history.map(entry => entry.action))].sort(); }
  get filteredHistory() {
    const search = this.historyFilter.search.trim().toLocaleLowerCase('pl');
    return this.history.filter(entry => {
      const entryDate = String(entry.created_at || '').slice(0, 10);
      const searchable = `${entry.asset_name || ''} ${entry.inventory_number || ''} ${entry.details || ''}`.toLocaleLowerCase('pl');
      return (!this.historyFilter.asset_id || Number(entry.asset_id) === Number(this.historyFilter.asset_id))
        && (!this.historyFilter.action || entry.action === this.historyFilter.action)
        && (!this.historyFilter.date_from || entryDate >= this.historyFilter.date_from)
        && (!this.historyFilter.date_to || entryDate <= this.historyFilter.date_to)
        && (!search || searchable.includes(search));
    });
  }

  ngOnInit() { this.api.get('me').subscribe({ next: user => this.startSession(user), error: () => {} }); }
  startSession(user: any) {
    this.user = user;
    if (user.role === 'admin') { this.page = 'dashboard'; this.loadAll(); }
    else { this.page = 'profile'; this.loadProfile(); }
  }
  signIn() {
    this.error = '';
    this.api.post('login', this.login).subscribe({ next: user => this.startSession(user), error: e => this.error = e.error?.message || 'Nie udało się zalogować.' });
  }
  logout() { this.api.post('logout', {}).subscribe(() => { this.user = null; this.page = 'dashboard'; this.cancel(); }); }
  loadAll() {
    this.loadDashboard(); this.load('assets'); this.load('categories'); this.load('locations'); this.load('history');
    if (this.isAdmin) { this.load('employees'); this.load('users'); }
  }
  load(page: string) { this.api.get(page).subscribe({ next: (data: any[]) => (this as any)[page] = data, error: e => this.error = e.error?.message || 'Nie udało się pobrać danych.' }); }
  loadDashboard() { this.api.get('dashboard').subscribe(data => this.dashboard = data); }
  loadProfile() { this.api.get('profile').subscribe(data => this.profile = data); }
  go(page: Page) {
    this.error = ''; this.message = ''; this.accountResult = null; this.cancel();
    if (!this.isAdmin && page !== 'profile') { this.page = 'profile'; this.message = 'Ten dział jest dostępny tylko dla administratora.'; this.loadProfile(); return; }
    this.page = page;
    if (page === 'dashboard') this.loadDashboard(); else if (page === 'profile') this.loadProfile(); else this.load(page);
  }

  emptyAsset() { return { name: '', serial_number: '', category_id: null, location_id: null }; }
  editAsset(asset: any) { if (!this.isAdmin) return; this.asset = { ...asset }; this.editingId = asset.id; window.scrollTo(0, 0); }
  saveAsset() {
    this.error = ''; this.message = '';
    const request = this.editingId ? this.api.put(`assets/${this.editingId}`, this.asset) : this.api.post('assets', this.asset);
    request.subscribe({ next: () => { this.message = 'Zapisano składnik majątku.'; this.cancel(); this.load('assets'); this.load('history'); this.loadDashboard(); }, error: e => this.showError(e) });
  }
  deleteAsset(id: number) { if (confirm('Usunąć ten składnik?')) this.api.delete(`assets/${id}`).subscribe({ next: () => { this.load('assets'); this.load('history'); this.loadDashboard(); }, error: e => this.showError(e) }); }
  assignAsset(asset: any) {
    this.error = ''; this.message = '';
    const employeeId = this.assignmentEmployee[asset.id];
    if (!employeeId) { this.error = 'Wybierz pracownika, któremu chcesz wydać składnik.'; return; }
    this.api.post(`assets/${asset.id}/assign`, { employee_id: employeeId }).subscribe({
      next: () => { this.message = `Wydano składnik ${asset.inventory_number}.`; delete this.assignmentEmployee[asset.id]; this.load('assets'); this.load('history'); this.loadDashboard(); },
      error: e => this.showError(e)
    });
  }
  returnAsset(asset: any) {
    if (!confirm(`Zarejestrować zwrot składnika ${asset.inventory_number}?`)) return;
    this.error = ''; this.message = '';
    this.api.post(`assets/${asset.id}/return`, {}).subscribe({
      next: () => { this.message = `Zarejestrowano zwrot składnika ${asset.inventory_number}.`; this.load('assets'); this.load('history'); this.loadDashboard(); },
      error: e => this.showError(e)
    });
  }
  openAssetHistory(asset: any) {
    this.error = ''; this.message = ''; this.accountResult = null; this.cancel();
    this.historyFilter = { asset_id: asset.id, action: '', date_from: '', date_to: '', search: '' };
    this.historyQuery = this.assetHistoryLabel(asset);
    this.page = 'history'; this.load('history'); window.scrollTo(0, 0);
  }
  assetHistoryLabel(asset: any) { return `${asset.inventory_number} — ${asset.name}`; }
  applyHistoryQuery(value: string) {
    this.historyQuery = value;
    const normalized = value.trim().toLocaleLowerCase('pl');
    const selectedAsset = this.assets.find(asset => {
      const label = this.assetHistoryLabel(asset).toLocaleLowerCase('pl');
      return label === normalized || String(asset.inventory_number).toLocaleLowerCase('pl') === normalized;
    });
    this.historyFilter.asset_id = selectedAsset?.id || null;
    this.historyFilter.search = selectedAsset ? '' : value;
  }
  clearHistoryFilters() {
    this.historyFilter = { asset_id: null, action: '', date_from: '', date_to: '', search: '' };
    this.historyQuery = '';
  }

  editEmployee(employee: any) {
    this.item = { ...employee, create_account: false, account_role: 'user' }; this.editingId = employee.id; this.accountResult = null; window.scrollTo(0, 0);
  }
  saveEmployee() {
    this.error = ''; this.message = ''; this.accountResult = null;
    const request = this.editingId ? this.api.put(`employees/${this.editingId}`, this.item) : this.api.post('employees', this.item);
    request.subscribe({
      next: result => {
        this.accountResult = result.account; this.message = result.account ? 'Pracownik i konto użytkownika zostały utworzone.' : 'Dane pracownika zostały zapisane.';
        this.cancel(); this.load('employees'); this.load('users'); this.loadDashboard();
      }, error: e => this.showError(e)
    });
  }
  editItem(item: any) { this.item = { ...item }; this.editingId = item.id; }
  saveItem(route: string) {
    this.error = ''; this.message = '';
    const request = this.editingId ? this.api.put(`${route}/${this.editingId}`, this.item) : this.api.post(route, this.item);
    request.subscribe({ next: () => { this.message = 'Dane zostały zapisane.'; this.cancel(); this.load(route); }, error: e => this.showError(e) });
  }
  deleteItem(route: string, id: number) { if (confirm('Usunąć rekord?')) this.api.delete(`${route}/${id}`).subscribe({ next: () => this.load(route), error: e => this.showError(e) }); }

  updateUser(account: any) {
    this.error = ''; this.api.put(`users/${account.id}`, { role: account.role, active: Boolean(account.active) }).subscribe({ next: () => { this.message = 'Uprawnienia użytkownika zostały zapisane.'; this.load('users'); }, error: e => { this.showError(e); this.load('users'); } });
  }
  toggleUser(account: any) { account.active = account.active ? 0 : 1; this.updateUser(account); }
  resetPassword(account: any) {
    if (!confirm(`Ustawić nowe hasło tymczasowe dla ${account.username}?`)) return;
    this.api.post(`users/${account.id}/reset-password`, {}).subscribe({ next: result => { this.accountResult = { username: account.username, temporary_password: result.temporary_password, role: account.role }; this.message = 'Wygenerowano nowe hasło tymczasowe.'; this.load('users'); }, error: e => this.showError(e) });
  }
  changePassword() {
    this.error = ''; this.message = '';
    if (this.passwordForm.new_password !== this.passwordForm.repeat_password) { this.error = 'Nowe hasła nie są takie same.'; return; }
    this.api.put('profile/password', this.passwordForm).subscribe({
      next: result => { this.message = result.message; this.passwordForm = { current_password: '', new_password: '', repeat_password: '' }; this.loadProfile(); if (this.isAdmin) this.loadAll(); },
      error: e => this.showError(e)
    });
  }
  showError(error: any) { this.error = error.error?.message || 'Nie udało się wykonać operacji. Spróbuj ponownie.'; }
  cancel() { this.asset = this.emptyAsset(); this.item = { create_account: false, account_role: 'user' }; this.editingId = null; }
  count(name: string) { return this.dashboard[name]?.count || 0; }
}
