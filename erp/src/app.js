import { resolveApiAdapter } from "./api/factory.js";
import { disableLocalDemo, enableLocalDemo, isEmbeddedWindow, readRuntimeConfig } from "./config.js";
import { can } from "./permissions.js";
import {
  compactError,
  debounce,
  escapeHtml,
  fullName,
  remainingCount,
  zonedLocalDateTimeToIso,
} from "./utils.js";
import {
  consumeForm,
  customerDetailView,
  customerForm,
  customersView,
  dashboardView,
  errorView,
  frameBlockedView,
  globalSearchResults,
  inviteForm,
  inviteCompletionView,
  loadingView,
  loginView,
  mfaSetupPrompt,
  mfaVerifyForm,
  packageForm,
  pendingActivationView,
  restrictedAccessView,
  setupView,
  shellView,
  staffAccessForm,
  staffView,
} from "./views.js";

const INVITE_COMPLETED_SESSION_KEY = "cryo-erp-invite-completed";

export class ErpApp {
  constructor({ root, windowLike = globalThis.window, documentLike = globalThis.document }) {
    this.root = root;
    this.window = windowLike;
    this.document = documentLike;
    this.api = null;
    this.config = null;
    this.session = null;
    this.currentCustomer = null;
    this.currentStaff = [];
    this.pendingPrivilegedAction = null;
    this.dialogInvoker = null;
    this.customerQuery = "";
    this.customerPage = 1;
    this.routeSequence = 0;
    this.searchSequence = 0;
    this.eventsBound = false;
    this.runGlobalSearch = debounce((query) => this.searchCustomers(query), 250);
  }

  async start() {
    this.bindEvents();
    this.root.setAttribute("aria-busy", "true");
    if (isEmbeddedWindow(this.window)) {
      this.root.innerHTML = frameBlockedView();
      this.root.setAttribute("aria-busy", "false");
      return;
    }
    this.config = readRuntimeConfig({
      windowLike: this.window,
      locationLike: this.window.location,
      sessionStorageLike: this.window.sessionStorage,
    });

    if (this.config.status !== "ready") {
      this.renderSetup();
      return;
    }

    try {
      this.api = await resolveApiAdapter(this.config, this.window);
      this.session = await this.api.getSession();
    } catch (error) {
      if (error?.code === "AUTH_REQUIRED") this.session = null;
      else if (error?.code === "STAFF_INACTIVE") {
        await this.api?.signOut?.().catch(() => {});
        this.session = null;
        this.renderLogin(error.message);
        return;
      }
      else {
        this.renderSetup(error);
        return;
      }
    }

    if (!this.session?.user) {
      this.renderLogin();
      return;
    }


    if (this.session.user.status === "invited") {
      const completed = this.window.sessionStorage?.getItem(INVITE_COMPLETED_SESSION_KEY) === "1";
      this.renderInviteCompletion("", completed);
      return;
    }
    this.window.sessionStorage?.removeItem(INVITE_COMPLETED_SESSION_KEY);

    if (!this.window.location.hash) this.window.location.hash = "#/dashboard";
    await this.renderRoute();
  }

  bindEvents() {
    if (this.eventsBound) return;
    this.eventsBound = true;
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("submit", (event) => this.handleSubmit(event));
    this.root.addEventListener("input", (event) => this.handleInput(event));
    this.root.addEventListener("keydown", (event) => this.handleKeyDown(event));
    this.root.addEventListener(
      "cancel",
      (event) => {
        if (event.target.matches?.("#erp-dialog")) this.pendingPrivilegedAction = null;
      },
      true,
    );
    this.root.addEventListener(
      "close",
      (event) => {
        if (!event.target.matches?.("#erp-dialog")) return;
        event.target.removeAttribute("aria-labelledby");
        if (this.dialogInvoker?.isConnected) this.dialogInvoker.focus();
        this.dialogInvoker = null;
      },
      true,
    );
    this.window.addEventListener("hashchange", () => {
      if (this.session?.user) this.renderRoute();
    });
    this.document.addEventListener("click", (event) => {
      if (!event.target.closest?.(".global-search-wrap")) this.hideSearchResults();
    });
  }

  renderSetup(adapterError = null) {
    this.root.innerHTML = setupView(this.config, adapterError);
    this.root.setAttribute("aria-busy", "false");
  }

  renderLogin(error = "") {
    this.root.innerHTML = loginView({ localDemo: this.config?.mode === "local-demo", error });
    this.root.setAttribute("aria-busy", "false");
    this.root.querySelector("input")?.focus();
  }

  renderInviteCompletion(error = "", pending = false) {
    this.root.innerHTML = pending ? pendingActivationView(error) : inviteCompletionView(error);
    this.root.setAttribute("aria-busy", "false");
    this.root.querySelector("input")?.focus();
  }

  routePath() {
    const raw = this.window.location.hash.replace(/^#/, "") || "/dashboard";
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  renderShell(content, path = this.routePath()) {
    this.root.innerHTML = shellView({
      user: this.session.user,
      activePath: path,
      content,
      localDemo: this.config.mode === "local-demo",
    });
    this.root.setAttribute("aria-busy", "false");
  }

  async renderRoute() {
    const sequence = ++this.routeSequence;
    const path = this.routePath();
    this.currentCustomer = null;
    this.currentStaff = [];

    if (path.startsWith("/staff") && !can(this.session.user.role, "staff:view")) {
      this.window.location.hash = "#/dashboard";
      this.toast("Энэ хэсгийг харах эрх хүрэлцэхгүй.", "error");
      return;
    }
    if (path.startsWith("/customers") && !can(this.session.user.role, "customers:view")) {
      this.window.location.hash = "#/dashboard";
      return;
    }

    this.renderShell(loadingView(), path);
    try {
      let content;
      if (path === "/" || path === "/dashboard") {
        content = can(this.session.user.role, "dashboard:view")
          ? dashboardView(await this.api.getDashboard())
          : restrictedAccessView();
      } else if (path === "/customers") {
        const result = await this.api.listCustomers({
          query: this.customerQuery,
          page: this.customerPage,
          pageSize: 25,
        });
        content = customersView({ result, query: this.customerQuery, role: this.session.user.role });
      } else if (path.startsWith("/customers/")) {
        const customerId = decodeURIComponent(path.slice("/customers/".length));
        if (!customerId || customerId.includes("/")) throw new Error("Үйлчлүүлэгчийн холбоос буруу байна.");
        this.currentCustomer = await this.api.getCustomer(customerId);
        content = customerDetailView(this.currentCustomer, this.session.user.role);
      } else if (path === "/staff") {
        this.currentStaff = await this.api.listStaff();
        content = staffView(this.currentStaff, this.session.user.role, this.session.user.id);
      } else {
        content = errorView("Хүссэн хуудас олдсонгүй.", "/dashboard");
      }

      if (sequence !== this.routeSequence) return;
      this.renderShell(content, path);
    } catch (error) {
      if (sequence !== this.routeSequence) return;
      if (error?.code === "AUTH_REQUIRED") {
        this.session = null;
        this.renderLogin("Нэвтрэх хугацаа дууссан байна.");
        return;
      }
      this.renderShell(errorView(compactError(error), path), path);
    }
  }

  async handleClick(event) {
    const actionTarget = event.target.closest?.("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;

    if (action === "toggle-nav") {
      const shell = this.root.querySelector("[data-shell]");
      const open = shell?.classList.toggle("nav-open") ?? false;
      this.root.querySelector(".menu-button")?.setAttribute("aria-expanded", String(open));
      return;
    }

    if (action === "enable-demo") {
      enableLocalDemo(this.window.sessionStorage);
      await this.start();
      return;
    }

    if (action === "refresh-session") {
      await this.start();
      return;
    }

    if (action === "signout") {
      actionTarget.disabled = true;
      try {
        await this.api.signOut();
        this.window.sessionStorage?.removeItem(INVITE_COMPLETED_SESSION_KEY);
        if (this.config.mode === "local-demo") disableLocalDemo(this.window.sessionStorage);
        this.session = null;
        this.api = null;
        await this.start();
      } catch (error) {
        actionTarget.disabled = false;
        this.toast(compactError(error), "error");
      }
      return;
    }

    if (action === "dialog-close") {
      this.pendingPrivilegedAction = null;
      this.closeDialog();
      return;
    }

    if (action === "customer-add") {
      if (!can(this.session.user.role, "customers:create")) return this.toast("Эрх хүрэлцэхгүй.", "error");
      this.openDialog(customerForm());
      return;
    }

    if (action === "customer-edit") {
      if (!can(this.session.user.role, "customers:edit")) return this.toast("Эрх хүрэлцэхгүй.", "error");
      try {
        const customer =
          this.currentCustomer?.id === actionTarget.dataset.customerId
            ? this.currentCustomer
            : await this.api.getCustomer(actionTarget.dataset.customerId);
        this.openDialog(customerForm(customer));
      } catch (error) {
        this.toast(compactError(error), "error");
      }
      return;
    }

    if (action === "package-add") {
      if (!can(this.session.user.role, "packages:create")) return this.toast("Эрх хүрэлцэхгүй.", "error");
      try {
        const services = await this.api.listServices();
        if (!services.length) throw new Error("Идэвхтэй үйлчилгээ бүртгэгдээгүй байна.");
        this.openDialog(packageForm(actionTarget.dataset.customerId, services));
      } catch (error) {
        this.toast(compactError(error), "error");
      }
      return;
    }

    if (action === "consume") {
      if (!can(this.session.user.role, "entitlements:consume")) return this.toast("Эрх хүрэлцэхгүй.", "error");
      try {
        const customer =
          this.currentCustomer?.id === actionTarget.dataset.customerId
            ? this.currentCustomer
            : await this.api.getCustomer(actionTarget.dataset.customerId);
        const entitlement = customer.entitlements?.find(
          (item) => item.id === actionTarget.dataset.entitlementId,
        );
        const available =
          entitlement?.available ?? (entitlement?.status === "active" && remainingCount(entitlement) > 0);
        if (!entitlement || !available || remainingCount(entitlement) < 1) {
          throw new Error("Ашиглах боломжтой эрх олдсонгүй.");
        }
        this.openDialog(consumeForm(customer.id, entitlement));
      } catch (error) {
        this.toast(compactError(error), "error");
      }
      return;
    }

    if (action === "staff-invite") {
      if (!can(this.session.user.role, "staff:invite")) return this.toast("Эрх хүрэлцэхгүй.", "error");
      const idempotencyKey = this.window.crypto?.randomUUID?.();
      if (!idempotencyKey) return this.toast("Browser аюулгүй request ID үүсгэх боломжгүй байна.", "error");
      await this.requirePrivilegedMfa(() =>
        this.openDialog(inviteForm(this.session.user.role, idempotencyKey)),
      );
      return;
    }

    if (action === "customer-page") {
      const nextPage = Number(actionTarget.dataset.page);
      if (Number.isInteger(nextPage) && nextPage > 0) {
        this.customerPage = nextPage;
        await this.renderRoute();
        this.root.querySelector("#main-content")?.focus();
      }
      return;
    }

    if (action === "staff-edit") {
      if (!can(this.session.user.role, "staff:update")) return this.toast("Эрх хүрэлцэхгүй.", "error");
      const person = this.currentStaff.find((item) => item.id === actionTarget.dataset.staffId);
      if (!person) return this.toast("Ажилтан олдсонгүй.", "error");
      await this.requirePrivilegedMfa(() =>
        this.openDialog(staffAccessForm(person, this.session.user.role)),
      );
      return;
    }

    if (action === "account-security") {
      await this.requirePrivilegedMfa(() => this.toast("MFA баталгаажуулалт идэвхтэй байна."));
      return;
    }

    if (action === "mfa-enroll") {
      actionTarget.disabled = true;
      try {
        const enrollment = await this.api.beginMfaEnrollment();
        this.openDialog(mfaVerifyForm(enrollment));
      } catch (error) {
        actionTarget.disabled = false;
        this.toast(compactError(error), "error");
      }
      return;
    }

    if (action === "tab") this.activateTab(actionTarget);
  }

  async handleSubmit(event) {
    const form = event.target.closest?.("form[data-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;

    if (kind === "global-search") {
      const results = this.root.querySelector("#global-search-results");
      const firstLink = results?.querySelector("a");
      if (firstLink) firstLink.click();
      else this.runGlobalSearch(data.query);
      return;
    }

    if (kind === "customer-filter") {
      this.customerQuery = String(data.query ?? "").trim();
      this.customerPage = 1;
      await this.renderRoute();
      return;
    }

    this.setFormPending(form, true);
    try {
      if (kind === "login") {
        this.session = await this.api.signIn(data);
        if (!this.session?.user) throw new Error("Нэвтрэх мэдээлэл буцаж ирсэнгүй.");
        if (!this.window.location.hash) this.window.location.hash = "#/dashboard";
        await this.renderRoute();
        return;
      }

      if (kind === "invite-complete") {
        if (String(data.password) !== String(data.confirmPassword)) {
          throw new Error("Нууц үгийн баталгаажуулалт таарахгүй байна.");
        }
        this.session = await this.api.completeInvite({ password: data.password });
        if (this.session?.user?.status === "active") {
          this.window.sessionStorage?.removeItem(INVITE_COMPLETED_SESSION_KEY);
          this.window.location.hash = "#/dashboard";
          await this.renderRoute();
        } else {
          this.window.sessionStorage?.setItem(INVITE_COMPLETED_SESSION_KEY, "1");
          this.renderInviteCompletion("Нууц үг тохируулагдсан. Админ эрхийг идэвхжүүлсний дараа шинэчилнэ үү.", true);
        }
        return;
      }

      if (kind === "customer") {
        const customerId = form.dataset.customerId;
        const saved = customerId
          ? await this.api.updateCustomer(customerId, data)
          : await this.api.createCustomer(data);
        this.closeDialog();
        this.toast(customerId ? "Мэдээлэл шинэчлэгдлээ." : "Үйлчлүүлэгч бүртгэгдлээ.");
        this.window.location.hash = `#/customers/${encodeURIComponent(saved.id)}`;
        if (this.routePath().endsWith(encodeURIComponent(saved.id))) await this.renderRoute();
        return;
      }

      if (kind === "package") {
        const purchasedAt = data.purchasedAt ? zonedLocalDateTimeToIso(data.purchasedAt) : null;
        if (data.purchasedAt && !purchasedAt) {
          throw new Error("Худалдан авсан огноо, цаг буруу байна.");
        }
        await this.api.createCustomerPackage({
          customerId: form.dataset.customerId,
          name: data.name,
          purchasedAt,
          startsOn: data.startsOn,
          expiresOn: data.expiresOn,
          price: data.price,
          notes: data.notes,
          entitlements: [{ serviceId: data.serviceId, quantity: Number(data.quantity) }],
        });
        this.closeDialog();
        this.toast("Багц болон үйлчилгээний эрх нэмэгдлээ.");
        await this.renderRoute();
        return;
      }

      if (kind === "consume") {
        await this.api.consumeEntitlement({
          customerId: form.dataset.customerId,
          entitlementId: form.dataset.entitlementId,
          quantity: Number(data.quantity),
          note: data.note,
        });
        this.closeDialog();
        this.toast("Үйлчилгээ баталгаажиж, үлдэгдэл шинэчлэгдлээ.");
        await this.renderRoute();
        return;
      }

      if (kind === "invite") {
        await this.api.inviteStaff({ ...data, idempotencyKey: form.dataset.idempotencyKey });
        this.closeDialog();
        this.toast("Ажилтны урилга үүслээ.");
        await this.renderRoute();
        return;
      }

      if (kind === "staff-access") {
        await this.api.updateStaffAccess({
          staffId: form.dataset.staffId,
          role: data.role,
          status: data.status,
          reason: data.reason,
        });
        this.closeDialog();
        this.toast("Ажилтны эрх, төлөв шинэчлэгдлээ.");
        await this.renderRoute();
        return;
      }

      if (kind === "mfa-verify") {
        await this.api.verifyMfaChallenge({ factorId: form.dataset.factorId, code: data.code });
        const pending = this.pendingPrivilegedAction;
        this.pendingPrivilegedAction = null;
        this.closeDialog();
        this.toast("MFA баталгаажуулалт амжилттай.");
        if (pending) await pending();
      }
    } catch (error) {
      const message = compactError(error);
      if (kind === "login") this.renderLogin(message);
      else {
        this.setFormPending(form, false);
        this.showFormError(form, message);
      }
    }
  }

  handleInput(event) {
    if (event.target.id === "global-search-input") this.runGlobalSearch(event.target.value);
  }

  handleKeyDown(event) {
    if (event.target.id === "global-search-input" && event.key === "ArrowDown") {
      const first = this.root.querySelector('#global-search-results [role="option"]');
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.target.matches?.('[role="tab"]') && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = [...event.target.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(event.target);
      const target =
        event.key === "Home"
          ? tabs[0]
          : event.key === "End"
            ? tabs.at(-1)
            : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      if (target) {
        event.preventDefault();
        this.activateTab(target);
      }
    }
  }

  async searchCustomers(rawQuery) {
    const query = String(rawQuery ?? "").trim();
    const container = this.root.querySelector("#global-search-results");
    if (!container) return;
    const sequence = ++this.searchSequence;
    if (query.length < 2) {
      this.hideSearchResults();
      return;
    }

    container.hidden = false;
    this.root.querySelector("#global-search-input")?.setAttribute("aria-expanded", "true");
    container.innerHTML = '<div class="search-empty"><span class="spinner spinner--small"></span> Хайж байна…</div>';
    try {
      const items = await this.api.searchCustomers(query);
      if (sequence !== this.searchSequence || !container.isConnected) return;
      container.innerHTML = globalSearchResults(items);
    } catch (error) {
      if (sequence !== this.searchSequence || !container.isConnected) return;
      container.innerHTML = `<div class="search-empty search-empty--error">${escapeHtml(compactError(error))}</div>`;
    }
  }

  hideSearchResults() {
    const results = this.root.querySelector("#global-search-results");
    if (results) results.hidden = true;
    this.root.querySelector("#global-search-input")?.setAttribute("aria-expanded", "false");
  }

  openDialog(content) {
    const dialog = this.root.querySelector("#erp-dialog");
    const target = this.root.querySelector("#dialog-content");
    if (!dialog || !target) return;
    const wasOpen = dialog.open;
    if (!wasOpen) this.dialogInvoker = this.document.activeElement;
    target.innerHTML = content;
    const heading = target.querySelector("h1, h2");
    if (heading) {
      heading.id ||= "erp-dialog-title";
      dialog.setAttribute("aria-labelledby", heading.id);
    }
    if (!wasOpen && typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    target.querySelector("input, select, textarea, button")?.focus();
  }

  closeDialog() {
    const dialog = this.root.querySelector("#erp-dialog");
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
  }

  async requirePrivilegedMfa(callback) {
    try {
      const status = await this.api.getMfaStatus();
      if (status.currentLevel === "aal2") {
        await callback();
        return;
      }
      this.pendingPrivilegedAction = callback;
      if (status.verifiedFactor?.id) {
        this.openDialog(mfaVerifyForm({ factorId: status.verifiedFactor.id }));
      } else {
        this.openDialog(mfaSetupPrompt());
      }
    } catch (error) {
      this.pendingPrivilegedAction = null;
      this.toast(compactError(error), "error");
    }
  }

  activateTab(button) {
    const panel = this.root.querySelector(`#${CSS.escape(button.dataset.tab)}`);
    if (!panel) return;
    const container = button.closest(".tabs-panel");
    container.querySelectorAll('[role="tab"]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });
    container.querySelectorAll('[role="tabpanel"]').forEach((item) => {
      item.hidden = item !== panel;
    });
    button.focus();
  }

  setFormPending(form, pending) {
    form.toggleAttribute("aria-busy", pending);
    form.querySelectorAll("button, input, select, textarea").forEach((control) => {
      control.disabled = pending;
    });
  }

  showFormError(form, message) {
    form.querySelector("[data-form-error]")?.remove();
    const alert = this.document.createElement("div");
    alert.className = "alert alert--error";
    alert.dataset.formError = "";
    alert.setAttribute("role", "alert");
    alert.textContent = message;
    form.querySelector(".dialog-actions")?.before(alert);
  }

  toast(message, tone = "success") {
    const region = this.root.querySelector("#toast-region");
    if (!region) return;
    const toast = this.document.createElement("div");
    toast.className = `toast toast--${tone}`;
    toast.textContent = message;
    region.append(toast);
    this.window.setTimeout(() => toast.remove(), 4200);
  }
}
