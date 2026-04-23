// =============================================
// RED MARIA — Auth Module (auth.js)
// Secure user system with validation
// =============================================

const auth = {
    STORAGE_KEY: 'redmaria_users',
    SESSION_KEY: 'redmaria_session',

    // ---- Crypto: SHA-256 Hashing via Web Crypto API ----
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // ---- Token Generation ----
    generateSessionToken() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    },

    // ---- Storage Helpers ----
    getUsers() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
        } catch {
            return [];
        }
    },

    saveUsers(users) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(users));
    },

    getSession() {
        try {
            return JSON.parse(localStorage.getItem(this.SESSION_KEY));
        } catch {
            return null;
        }
    },

    saveSession(session) {
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    },

    clearSession() {
        localStorage.removeItem(this.SESSION_KEY);
    },

    // ---- Validators ----
    validators: {
        name(value) {
            const v = (value || '').trim();
            if (!v) return 'El nombre es obligatorio';
            if (v.length < 3) return 'El nombre debe tener al menos 3 caracteres';
            if (v.length > 60) return 'El nombre es demasiado largo';
            if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(v)) return 'El nombre contiene caracteres no válidos';
            return '';
        },

        email(value) {
            const v = (value || '').trim();
            if (!v) return 'El email es obligatorio';
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!re.test(v)) return 'Ingresa un email válido';
            return '';
        },

        password(value) {
            const v = value || '';
            if (!v) return 'La contraseña es obligatoria';
            if (v.length < 8) return 'Mínimo 8 caracteres';
            if (!/[A-Z]/.test(v)) return 'Debe incluir al menos una mayúscula';
            if (!/[a-z]/.test(v)) return 'Debe incluir al menos una minúscula';
            if (!/[0-9]/.test(v)) return 'Debe incluir al menos un número';
            if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v)) return 'Debe incluir un carácter especial (!@#$%...)';
            return '';
        },

        confirmPassword(value, password) {
            if (!value) return 'Confirma tu contraseña';
            if (value !== password) return 'Las contraseñas no coinciden';
            return '';
        },

        city(value) {
            const v = (value || '').trim();
            if (!v) return 'La ciudad es obligatoria';
            if (v.length < 2) return 'Ciudad muy corta';
            return '';
        }
    },

    // ---- Password Strength Meter ----
    getPasswordStrength(password) {
        if (!password) return { score: 0, label: '', className: '' };

        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (score <= 2) return { score: 1, label: 'Débil', className: 'strength-weak' };
        if (score <= 4) return { score: 2, label: 'Media', className: 'strength-medium' };
        return { score: 3, label: 'Fuerte', className: 'strength-strong' };
    },

    // ---- Sanitize Input ----
    sanitize(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ---- Register ----
    async registerUser({ name, email, password, city }) {
        // Sanitize
        name = this.sanitize(name.trim());
        email = this.sanitize(email.trim().toLowerCase());
        city = this.sanitize(city.trim());

        // Check if email already exists
        const users = this.getUsers();
        if (users.find(u => u.email === email)) {
            return { success: false, error: 'Este email ya está registrado' };
        }

        // Hash password
        const hashedPassword = await this.hashPassword(password);

        // Create user object
        const user = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            name,
            email,
            password: hashedPassword,
            city,
            createdAt: new Date().toISOString(),
            rosariosCount: 0,
            devotion: 'Ntra. Sra. de Luján'
        };

        users.push(user);
        this.saveUsers(users);

        // Sync with Supabase Auth
        if (typeof db !== 'undefined' && db.signUp) {
            db.signUp(email, password, name).then(function(result) {
                if (result.error) console.warn('Supabase signup:', result.error.message);
                else console.log('✅ Usuario registrado en Supabase');
            }).catch(function(e) { console.error('Supabase signup error:', e); });
        }

        // Auto-login after registration
        const token = this.generateSessionToken();
        this.saveSession({
            token,
            userId: user.id,
            email: user.email,
            name: user.name,
            city: user.city,
            loginAt: new Date().toISOString()
        });

        return { success: true, user };
    },

    // ---- Login ----
    async loginUser(email, password) {
        email = email.trim().toLowerCase();
        const hashedPassword = await this.hashPassword(password);

        const users = this.getUsers();
        const user = users.find(u => u.email === email && u.password === hashedPassword);

        if (!user) {
            return { success: false, error: 'Email o contraseña incorrectos' };
        }

        const token = this.generateSessionToken();
        this.saveSession({
            token,
            userId: user.id,
            email: user.email,
            name: user.name,
            city: user.city,
            loginAt: new Date().toISOString()
        });

        return { success: true, user };
    },

    // ---- Logout ----
    logoutUser() {
        this.clearSession();
        // Sync with Supabase
        if (typeof db !== 'undefined' && db.signOut) { db.signOut(); }
    },

    // ---- Session Checks ----
    isAuthenticated() {
        const session = this.getSession();
        return !!(session && session.token && session.userId);
    },

    getCurrentUser() {
        const session = this.getSession();
        if (!session) return null;

        const users = this.getUsers();
        const user = users.find(u => u.id === session.userId);
        if (!user) {
            this.clearSession();
            return null;
        }

        // Return safe data (no password)
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            city: user.city,
            rosariosCount: user.rosariosCount,
            devotion: user.devotion,
            createdAt: user.createdAt
        };
    },

    // ---- Reset Password ----
    async resetPassword(email, newPassword) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.email === email);
        if (idx === -1) return { success: false, error: 'Usuario no encontrado' };
        const hashed = await this.hashPassword(newPassword);
        users[idx].password = hashed;
        this.saveUsers(users);
        return { success: true };
    },

    // ---- Protected Screens ----
    protectedScreens: ['screen-map', 'screen-create-rosary', 'screen-rosary-detail', 'screen-rezo', 'screen-event', 'screen-live', 'screen-profile'],

    isProtected(screenId) {
        return this.protectedScreens.includes(screenId);
    }
};

// =============================================
// AUTH UI CONTROLLER
// Handles form interactions and visual feedback
// =============================================

const authUI = {
    // Current visible form
    currentForm: 'register', // 'register' | 'login'

    init() {
        this.setupRegisterForm();
        this.setupLoginForm();
        this.setupPasswordToggles();
        this.setupPasswordStrength();
        this.setupRealTimeValidation();
    },

    // ---- Register Form ----
    setupRegisterForm() {
        const form = document.getElementById('register-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const confirmPw = document.getElementById('reg-confirm-password').value;
            const city = document.getElementById('reg-city').value;

            // Validate all fields
            const errors = {
                name: auth.validators.name(name),
                email: auth.validators.email(email),
                password: auth.validators.password(password),
                confirmPassword: auth.validators.confirmPassword(confirmPw, password),
                city: auth.validators.city(city)
            };

            // Show errors
            let hasErrors = false;
            for (const [field, error] of Object.entries(errors)) {
                const inputId = field === 'confirmPassword' ? 'reg-confirm-password' : `reg-${field}`;
                this.setFieldError(inputId, error);
                if (error) hasErrors = true;
            }

            if (hasErrors) {
                this.shakeForm('register-form');
                return;
            }

            // Show loading
            const btn = form.querySelector('.btn-auth-submit');
            btn.classList.add('loading');
            btn.disabled = true;

            // Simulate slight delay for UX
            await new Promise(r => setTimeout(r, 600));

            const result = await auth.registerUser({ name, email, password, city });

            btn.classList.remove('loading');
            btn.disabled = false;

            if (result.success) {
                this.showSuccess('register-form', '¡Cuenta creada exitosamente!');
                setTimeout(() => {
                    app.onAuthSuccess();
                }, 1000);
            } else {
                this.setFieldError('reg-email', result.error);
                this.shakeForm('register-form');
            }
        });
    },

    // ---- Login Form ----
    setupLoginForm() {
        const form = document.getElementById('login-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            // Validate
            const emailError = auth.validators.email(email);
            const pwError = password ? '' : 'La contraseña es obligatoria';

            this.setFieldError('login-email', emailError);
            this.setFieldError('login-password', pwError);

            if (emailError || pwError) {
                this.shakeForm('login-form');
                return;
            }

            // Show loading
            const btn = form.querySelector('.btn-auth-submit');
            btn.classList.add('loading');
            btn.disabled = true;

            await new Promise(r => setTimeout(r, 600));

            const result = await auth.loginUser(email, password);

            btn.classList.remove('loading');
            btn.disabled = false;

            if (result.success) {
                this.showSuccess('login-form', '¡Bienvenido de vuelta!');
                setTimeout(() => {
                    app.onAuthSuccess();
                }, 1000);
            } else {
                this.showFormError('login-form', result.error);
                this.shakeForm('login-form');
            }
        });
    },

    // ---- Password Visibility Toggle ----
    setupPasswordToggles() {
        document.querySelectorAll('.toggle-password').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = btn.parentElement.querySelector('input');
                const icon = btn.querySelector('i');
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.className = 'ri-eye-off-line';
                } else {
                    input.type = 'password';
                    icon.className = 'ri-eye-line';
                }
            });
        });
    },

    // ---- Password Strength Meter ----
    setupPasswordStrength() {
        const pwInput = document.getElementById('reg-password');
        if (!pwInput) return;

        pwInput.addEventListener('input', () => {
            const strength = auth.getPasswordStrength(pwInput.value);
            const meter = document.getElementById('password-strength-meter');
            const label = document.getElementById('password-strength-label');
            
            if (meter) {
                meter.className = 'password-strength-meter';
                if (pwInput.value) {
                    meter.classList.add(strength.className);
                    meter.dataset.score = strength.score;
                }
            }
            if (label) {
                label.textContent = strength.label;
                label.className = 'password-strength-label ' + strength.className;
            }
        });
    },

    // ---- Real-time Validation ----
    setupRealTimeValidation() {
        const fields = [
            { id: 'reg-name', validator: 'name' },
            { id: 'reg-email', validator: 'email' },
            { id: 'reg-city', validator: 'city' }
        ];

        fields.forEach(({ id, validator }) => {
            const input = document.getElementById(id);
            if (!input) return;

            input.addEventListener('blur', () => {
                const error = auth.validators[validator](input.value);
                this.setFieldError(id, error);
            });

            input.addEventListener('input', () => {
                // Clear error on typing
                this.clearFieldError(id);
            });
        });

        // Confirm password real-time check
        const confirmPw = document.getElementById('reg-confirm-password');
        const pw = document.getElementById('reg-password');
        if (confirmPw && pw) {
            confirmPw.addEventListener('input', () => {
                if (confirmPw.value) {
                    const error = auth.validators.confirmPassword(confirmPw.value, pw.value);
                    this.setFieldError('reg-confirm-password', error);
                } else {
                    this.clearFieldError('reg-confirm-password');
                }
            });
        }
    },

    // ---- UI Feedback Helpers ----
    setFieldError(inputId, errorMsg) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const group = input.closest('.auth-field');
        if (!group) return;
        const errorEl = group.querySelector('.field-error');

        if (errorMsg) {
            group.classList.add('has-error');
            group.classList.remove('has-success');
            if (errorEl) errorEl.textContent = errorMsg;
        } else {
            group.classList.remove('has-error');
            if (input.value.trim()) {
                group.classList.add('has-success');
            }
            if (errorEl) errorEl.textContent = '';
        }
    },

    clearFieldError(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const group = input.closest('.auth-field');
        if (!group) return;
        group.classList.remove('has-error');
        const errorEl = group.querySelector('.field-error');
        if (errorEl) errorEl.textContent = '';
    },

    showFormError(formId, message) {
        const form = document.getElementById(formId);
        if (!form) return;
        let errorBanner = form.querySelector('.form-error-banner');
        if (!errorBanner) {
            errorBanner = document.createElement('div');
            errorBanner.className = 'form-error-banner';
            form.prepend(errorBanner);
        }
        errorBanner.innerHTML = `<i class="ri-error-warning-fill"></i> ${message}`;
        errorBanner.classList.add('visible');
        setTimeout(() => errorBanner.classList.remove('visible'), 4000);
    },

    showSuccess(formId, message) {
        const form = document.getElementById(formId);
        if (!form) return;
        let successBanner = form.querySelector('.form-success-banner');
        if (!successBanner) {
            successBanner = document.createElement('div');
            successBanner.className = 'form-success-banner';
            form.prepend(successBanner);
        }
        successBanner.innerHTML = `<i class="ri-checkbox-circle-fill"></i> ${message}`;
        successBanner.classList.add('visible');
    },

    shakeForm(formId) {
        const form = document.getElementById(formId);
        if (!form) return;
        form.classList.add('shake');
        setTimeout(() => form.classList.remove('shake'), 500);
    },

    // Switch between login/register views
    showRegister() {
        document.getElementById('auth-register-view')?.classList.add('active');
        document.getElementById('auth-login-view')?.classList.remove('active');
        this.currentForm = 'register';
    },

    showLogin() {
        document.getElementById('auth-login-view')?.classList.add('active');
        document.getElementById('auth-register-view')?.classList.remove('active');
        this.currentForm = 'login';
    }
};
