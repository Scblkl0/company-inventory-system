import express from 'express';
import session from 'express-session';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { db, history } from './database';

type SessionUser = { id: number; username: string; role: 'admin' | 'user'; employee_id: number | null };
declare module 'express-session' { interface SessionData { user?: SessionUser } }

const app = express();
const localFrontendOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200', 'http://localhost:4201', 'http://127.0.0.1:4201'];
app.use(cors({ origin: localFrontendOrigins, credentials: true }));
app.use(express.json());
app.use(session({ secret: 'student-project-secret-change-me', resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 8 } }));

function publicError(message: string, status = 400) { const error: any = new Error(message); error.publicMessage = message; error.status = status; return error; }
const requireLogin: express.RequestHandler = (req, res, next) => req.session.user ? next() : res.status(401).json({ message: 'Zaloguj się, aby kontynuować.' });
const requireAdmin: express.RequestHandler = (req, res, next) => req.session.user?.role === 'admin' ? next() : res.status(403).json({ message: 'Ta operacja jest dostępna tylko dla administratora.' });
function sessionUser(row: any): SessionUser { return { id: row.id, username: row.username, role: row.role, employee_id: row.employee_id || null }; }

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}
function loginBase(firstName: string, lastName: string) {
  return `${firstName}.${lastName}`.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') || 'user';
}
function uniqueUsername(firstName: string, lastName: string) {
  const base = loginBase(firstName, lastName); let username = base; let suffix = 2;
  while (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) username = `${base}${suffix++}`;
  return username;
}
function validateRole(role: string) { return role === 'admin' ? 'admin' : 'user'; }
function assertEmailAvailableForAccount(email: string, employeeId?: number) {
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) return;
  const conflict = db.prepare(`SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id
    WHERE lower(trim(e.email))=lower(?) AND e.id<>? LIMIT 1`).get(normalizedEmail, employeeId || 0);
  if (conflict) throw publicError('Ten e-mail jest już używany do logowania przez inne konto. Wpisz inny adres.');
}
function createGeneratedAccount(employeeId: number, firstName: string, lastName: string, role: string) {
  const username = uniqueUsername(firstName, lastName); const password = generatePassword(); const accountRole = validateRole(role);
  db.prepare(`INSERT INTO users (username,password,role,employee_id,active,must_change_password,created_at) VALUES (?,?,?,?,1,0,CURRENT_TIMESTAMP)`)
    .run(username, bcrypt.hashSync(password, 10), accountRole, employeeId);
  return { username, temporary_password: password, role: accountRole };
}

app.post('/api/login', (req, res) => {
  const identifier = String(req.body.username || '').trim();
  let user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(identifier) as any;
  if (!user && identifier) {
    const emailMatches = db.prepare(`SELECT u.* FROM users u JOIN employees e ON e.id=u.employee_id
      WHERE lower(trim(e.email))=lower(?)`).all(identifier) as any[];
    if (emailMatches.length > 1) return res.status(409).json({ message: 'Ten e-mail jest przypisany do kilku kont. Skontaktuj się z administratorem.' });
    user = emailMatches[0];
  }
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password)) return res.status(401).json({ message: 'Nieprawidłowy login, e-mail lub hasło.' });
  if (!user.active) return res.status(403).json({ message: 'To konto jest zablokowane. Skontaktuj się z administratorem.' });
  req.session.user = sessionUser(user); res.json(req.session.user);
});
app.post('/api/logout', requireLogin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => req.session.user ? res.json(req.session.user) : res.status(401).end());

app.get('/api/profile', requireLogin, (req, res) => {
  const profile = db.prepare(`SELECT u.id,u.username,u.role,u.employee_id,e.first_name,e.last_name,e.email,e.department,e.position
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?`).get(req.session.user!.id) as any;
  const assets = profile?.employee_id ? db.prepare(`SELECT a.*,c.name AS category_name,l.name AS location_name FROM assets a
    LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN locations l ON l.id=a.location_id WHERE a.employee_id=? ORDER BY a.id DESC`).all(profile.employee_id) : [];
  res.json({ ...profile, assets });
});
app.put('/api/profile/password', requireLogin, (req, res, next) => {
  try {
    const current = String(req.body.current_password || ''); const nextPassword = String(req.body.new_password || '');
    const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.session.user!.id) as any;
    if (!bcrypt.compareSync(current, user.password)) throw publicError('Aktualne hasło jest nieprawidłowe.');
    if (nextPassword.length < 6) throw publicError('Nowe hasło musi mieć co najmniej 6 znaków.');
    if (current === nextPassword) throw publicError('Nowe hasło musi różnić się od aktualnego.');
    db.prepare('UPDATE users SET password=?,must_change_password=0 WHERE id=?').run(bcrypt.hashSync(nextPassword, 10), req.session.user!.id);
    res.json({ message: 'Hasło zostało zmienione.' });
  } catch (error) { next(error); }
});

app.get('/api/dashboard', requireLogin, requireAdmin, (_req, res) => res.json({
  assets: db.prepare('SELECT COUNT(*) AS count FROM assets').get(), employees: db.prepare('SELECT COUNT(*) AS count FROM employees').get(),
  available: db.prepare('SELECT COUNT(*) AS count FROM assets WHERE employee_id IS NULL').get(), assigned: db.prepare('SELECT COUNT(*) AS count FROM assets WHERE employee_id IS NOT NULL').get()
}));

const employeeFields = ['first_name', 'last_name', 'email', 'department', 'position'];
const employeeSelect = `SELECT e.*,u.id AS user_id,u.username,u.role,u.active FROM employees e LEFT JOIN users u ON u.employee_id=e.id`;
app.get('/api/employees', requireLogin, requireAdmin, (_req, res) => res.json(db.prepare(`${employeeSelect} ORDER BY e.id DESC`).all()));
const createEmployee = db.transaction((body: any) => {
  if (body.create_account) assertEmailAvailableForAccount(body.email);
  const values = employeeFields.map(field => body[field] || null);
  const result = db.prepare(`INSERT INTO employees (${employeeFields.join(',')}) VALUES (${employeeFields.map(() => '?').join(',')})`).run(...values);
  const employeeId = Number(result.lastInsertRowid); let account: any = null;
  if (body.create_account) account = createGeneratedAccount(employeeId, body.first_name, body.last_name, body.account_role);
  return { employee: db.prepare(`${employeeSelect} WHERE e.id=?`).get(employeeId), account };
});
app.post('/api/employees', requireLogin, requireAdmin, (req, res, next) => { try { res.status(201).json(createEmployee(req.body)); } catch (error) { next(error); } });
app.put('/api/employees/:id', requireLogin, requireAdmin, (req, res, next) => {
  try {
    const employeeId = Number(req.params.id);
    const currentUser = db.prepare('SELECT id FROM users WHERE employee_id=?').get(employeeId);
    if (currentUser || req.body.create_account) assertEmailAvailableForAccount(req.body.email, employeeId);
    const values = employeeFields.map(field => req.body[field] || null);
    db.prepare(`UPDATE employees SET ${employeeFields.map(field => `${field}=?`).join(',')} WHERE id=?`).run(...values, req.params.id);
    let account: any = null;
    if (req.body.create_account && !currentUser) account = createGeneratedAccount(Number(req.params.id), req.body.first_name, req.body.last_name, req.body.account_role);
    res.json({ employee: db.prepare(`${employeeSelect} WHERE e.id=?`).get(req.params.id), account });
  } catch (error) { next(error); }
});
app.delete('/api/employees/:id', requireLogin, requireAdmin, (req, res, next) => {
  try {
    if (db.prepare('SELECT 1 FROM users WHERE employee_id=?').get(req.params.id)) throw publicError('Pracownik powiązany z kontem użytkownika nie może zostać usunięty.');
    if (db.prepare('SELECT 1 FROM assets WHERE employee_id=?').get(req.params.id)) throw publicError('Pracownik ma przypisane wyposażenie. Najpierw zarejestruj jego zwrot.');
    db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id); res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/users', requireLogin, requireAdmin, (_req, res) => res.json(db.prepare(`SELECT u.id,u.username,u.role,u.active,u.created_at,u.employee_id,
  trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) AS employee_name,e.department,e.position
  FROM users u LEFT JOIN employees e ON e.id=u.employee_id ORDER BY u.id DESC`).all()));
app.put('/api/users/:id', requireLogin, requireAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id); const role = validateRole(req.body.role); const active = req.body.active ? 1 : 0;
    if (id === req.session.user!.id && (!active || role !== 'admin')) throw publicError('Nie możesz zablokować własnego konta ani odebrać sobie roli administratora.');
    db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role, active, id); res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post('/api/users/:id/reset-password', requireLogin, requireAdmin, (req, res, next) => {
  try {
    const password = String(req.body.password || '').trim() || generatePassword();
    if (password.length < 6) throw publicError('Hasło tymczasowe musi mieć co najmniej 6 znaków.');
    db.prepare('UPDATE users SET password=?,must_change_password=0 WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
    res.json({ temporary_password: password });
  } catch (error) { next(error); }
});

const simpleTables: Record<string, { table: string; fields: string[] }> = {
  categories: { table: 'categories', fields: ['name', 'description'] }, locations: { table: 'locations', fields: ['name', 'address'] }
};
Object.entries(simpleTables).forEach(([route, config]) => {
  app.get(`/api/${route}`, requireLogin, requireAdmin, (_req, res) => res.json(db.prepare(`SELECT * FROM ${config.table} ORDER BY id DESC`).all()));
  app.post(`/api/${route}`, requireLogin, requireAdmin, (req, res) => {
    const values = config.fields.map(field => req.body[field] || null);
    const result = db.prepare(`INSERT INTO ${config.table} (${config.fields.join(',')}) VALUES (${config.fields.map(() => '?').join(',')})`).run(...values);
    res.status(201).json(db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(result.lastInsertRowid));
  });
  app.put(`/api/${route}/:id`, requireLogin, requireAdmin, (req, res) => {
    const values = config.fields.map(field => req.body[field] || null);
    db.prepare(`UPDATE ${config.table} SET ${config.fields.map(field => `${field}=?`).join(',')} WHERE id=?`).run(...values, req.params.id);
    res.json(db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(req.params.id));
  });
  app.delete(`/api/${route}/:id`, requireLogin, requireAdmin, (req, res) => { db.prepare(`DELETE FROM ${config.table} WHERE id=?`).run(req.params.id); res.status(204).end(); });
});

const assetSelect = `SELECT a.*,CASE WHEN a.employee_id IS NULL THEN 'available' ELSE 'assigned' END AS status,
  c.name AS category_name,l.name AS location_name,trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) AS employee_name
  FROM assets a LEFT JOIN categories c ON a.category_id=c.id LEFT JOIN locations l ON a.location_id=l.id LEFT JOIN employees e ON a.employee_id=e.id`;
const assetFields = ['name','serial_number','category_id','location_id'];
app.get('/api/assets', requireLogin, requireAdmin, (_req, res) => res.json(db.prepare(`${assetSelect} ORDER BY a.id DESC`).all()));
const createAsset = db.transaction((body: any) => {
  const values = assetFields.map(field => body[field] || null);
  const result = db.prepare(`INSERT INTO assets (${assetFields.join(',')}) VALUES (${assetFields.map(() => '?').join(',')})`).run(...values);
  const id = Number(result.lastInsertRowid); const inventoryNumber = `INV-${String(id).padStart(6, '0')}`;
  db.prepare('UPDATE assets SET inventory_number=? WHERE id=?').run(inventoryNumber, id);
  history(id, 'Dodano', `Dodano składnik ${inventoryNumber}: ${body.name}`);
  return db.prepare(`${assetSelect} WHERE a.id=?`).get(id);
});
app.post('/api/assets', requireLogin, requireAdmin, (req, res, next) => {
  try { res.status(201).json(createAsset(req.body)); } catch (error) { next(error); }
});
app.put('/api/assets/:id', requireLogin, requireAdmin, (req, res) => {
  const values = assetFields.map(field => req.body[field] || null); db.prepare(`UPDATE assets SET ${assetFields.map(field => `${field}=?`).join(',')} WHERE id=?`).run(...values, req.params.id);
  history(Number(req.params.id), 'Zmieniono', `Zaktualizowano składnik: ${req.body.name}`); res.json(db.prepare(`${assetSelect} WHERE a.id=?`).get(req.params.id));
});
app.post('/api/assets/:id/assign', requireLogin, requireAdmin, (req, res, next) => {
  try {
    const asset = db.prepare('SELECT id,name,inventory_number,employee_id FROM assets WHERE id=?').get(req.params.id) as any;
    if (!asset) throw publicError('Nie znaleziono składnika majątku.', 404);
    if (asset.employee_id) throw publicError('Ten składnik jest już wydany. Najpierw zarejestruj jego zwrot.');
    const employee = db.prepare("SELECT id,trim(first_name || ' ' || last_name) AS name FROM employees WHERE id=?").get(req.body.employee_id) as any;
    if (!employee) throw publicError('Wybierz pracownika, któremu chcesz wydać składnik.');
    db.prepare('UPDATE assets SET employee_id=? WHERE id=?').run(employee.id, asset.id);
    history(asset.id, 'Wydano', `Wydano ${asset.inventory_number} pracownikowi: ${employee.name}`);
    res.json(db.prepare(`${assetSelect} WHERE a.id=?`).get(asset.id));
  } catch (error) { next(error); }
});
app.post('/api/assets/:id/return', requireLogin, requireAdmin, (req, res, next) => {
  try {
    const asset = db.prepare(`${assetSelect} WHERE a.id=?`).get(req.params.id) as any;
    if (!asset) throw publicError('Nie znaleziono składnika majątku.', 404);
    if (!asset.employee_id) throw publicError('Ten składnik jest już dostępny.');
    db.prepare('UPDATE assets SET employee_id=NULL WHERE id=?').run(asset.id);
    history(asset.id, 'Zwrócono', `Zwrócono ${asset.inventory_number} od pracownika: ${asset.employee_name}`);
    res.json(db.prepare(`${assetSelect} WHERE a.id=?`).get(asset.id));
  } catch (error) { next(error); }
});
app.delete('/api/assets/:id', requireLogin, requireAdmin, (req, res, next) => {
  try {
    const asset = db.prepare('SELECT name,employee_id FROM assets WHERE id=?').get(req.params.id) as any;
    if (asset?.employee_id) throw publicError('Nie można usunąć wydanego składnika. Najpierw zarejestruj jego zwrot.');
    if (asset) history(Number(req.params.id), 'Usunięto', `Usunięto składnik: ${asset.name}`);
    db.prepare('DELETE FROM assets WHERE id=?').run(req.params.id); res.status(204).end();
  } catch (error) { next(error); }
});
app.get('/api/history', requireLogin, requireAdmin, (_req, res) => res.json(db.prepare('SELECT h.*,a.name AS asset_name,a.inventory_number FROM asset_history h LEFT JOIN assets a ON a.id=h.asset_id ORDER BY h.id DESC').all()));

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err); const technicalMessage = String(err?.message || ''); let message = err.publicMessage || 'Wystąpił błąd podczas zapisywania danych.';
  if (!err.publicMessage && technicalMessage.includes('categories.name')) message = 'Kategoria o tej nazwie już istnieje. Wpisz inną nazwę.';
  else if (!err.publicMessage && technicalMessage.includes('locations.name')) message = 'Lokalizacja o tej nazwie już istnieje. Wpisz inną nazwę.';
  else if (!err.publicMessage && technicalMessage.includes('assets.inventory_number')) message = 'Składnik z tym numerem inwentarzowym już istnieje. Wpisz inny numer.';
  else if (!err.publicMessage && technicalMessage.includes('users.username')) message = 'Użytkownik o takim loginie już istnieje.';
  else if (!err.publicMessage && technicalMessage.includes('UNIQUE constraint failed')) message = 'Taki rekord już istnieje. Zmień unikalną wartość i spróbuj ponownie.';
  else if (!err.publicMessage && technicalMessage.includes('NOT NULL constraint failed')) message = 'Uzupełnij wszystkie wymagane pola.';
  res.status(err.status || 400).json({ message });
});
app.listen(3000, () => console.log('Backend działa na http://localhost:3000'));
