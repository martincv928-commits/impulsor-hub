/* Capa de datos del panel de administración. Todas las acciones sensibles son
 * funciones de Postgres (admin_*) que verifican por dentro que quien llama es
 * un administrador de la plataforma; este archivo solo las invoca. */
(function (root) {
  'use strict';
  const CLOUD = root.QF.cloud;

  const admin = {
    async isAdmin() {
      const { data, error } = await CLOUD.client().from('platform_admins').select('id').limit(1).maybeSingle();
      if (error) return false;
      return !!data;
    },
    async dashboardStats() {
      const { data, error } = await CLOUD.client().rpc('admin_dashboard_stats');
      if (error) throw new Error(error.message);
      return data;
    },
    async listBusinesses(search) {
      const { data, error } = await CLOUD.client().rpc('admin_list_businesses', { p_search: search || null });
      if (error) throw new Error(error.message);
      return data;
    },
    async businessStats(businessId) {
      const { data, error } = await CLOUD.client().rpc('admin_business_stats', { p_business_id: businessId });
      if (error) throw new Error(error.message);
      return data;
    },
    async listMembers(businessId) {
      const { data, error } = await CLOUD.client().rpc('admin_list_members', { p_business_id: businessId });
      if (error) throw new Error(error.message);
      return data;
    },
    async setBusinessStatus(businessId, status, reason) {
      const { data, error } = await CLOUD.client().rpc('admin_set_business_status', { p_business_id: businessId, p_status: status, p_reason: reason || null });
      if (error) throw new Error(error.message);
      return data;
    },
    async setBusinessPlan(businessId, plan, reason) {
      const { data, error } = await CLOUD.client().rpc('admin_set_business_plan', { p_business_id: businessId, p_plan: plan, p_reason: reason || null });
      if (error) throw new Error(error.message);
      return data;
    },
    async setBusinessRenewal(businessId, renewsAtISO, reason) {
      const { data, error } = await CLOUD.client().rpc('admin_set_business_renewal', { p_business_id: businessId, p_renews_at: renewsAtISO, p_reason: reason || null });
      if (error) throw new Error(error.message);
      return data;
    },
    async addCourtesyDays(businessId, days, reason) {
      const { data, error } = await CLOUD.client().rpc('admin_add_courtesy_days', { p_business_id: businessId, p_days: days, p_reason: reason || null });
      if (error) throw new Error(error.message);
      return data;
    },
    async setMemberStatus(memberId, status, reason) {
      const { data, error } = await CLOUD.client().rpc('admin_set_member_status', { p_member_id: memberId, p_status: status, p_reason: reason || null });
      if (error) throw new Error(error.message);
      return data;
    },
    async listTickets() {
      const { data, error } = await CLOUD.client().from('support_tickets').select('*, businesses(name)').order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    async ticketMessages(ticketId) {
      const { data, error } = await CLOUD.client().from('support_ticket_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    async replyTicket(ticketId, adminId, body) {
      const { error } = await CLOUD.client().from('support_ticket_messages').insert({ ticket_id: ticketId, author_id: adminId, author_role: 'admin', body });
      if (error) throw new Error(error.message);
    },
    async setTicketStatus(ticketId, status) {
      const { error } = await CLOUD.client().from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', ticketId);
      if (error) throw new Error(error.message);
    },
    async supportAccess(ticketId) {
      const { data, error } = await CLOUD.client().rpc('admin_support_access', { p_ticket_id: ticketId });
      if (error) throw new Error(error.message);
      return data;
    },
    async auditLog(limit) {
      const { data, error } = await CLOUD.client().from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit || 50);
      if (error) throw new Error(error.message);
      return data;
    },
  };

  root.QFA = admin;
})(typeof globalThis !== 'undefined' ? globalThis : this);
