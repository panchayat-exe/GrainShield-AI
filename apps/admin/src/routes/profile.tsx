import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User, Lock, Save, Loader2, CheckCircle2, AlertCircle, Shield } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getAdminSession, type AdminUser } from "@/lib/admin-auth";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "My Profile | GrainShield AI Admin" },
      { name: "description", content: "View and update your GrainShield admin profile." },
    ],
  }),
  component: AdminProfile,
});

function AdminProfile() {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Password change
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    getAdminSession().then((u) => {
      if (!u) return;
      setAdminUser(u);
      setFullName(u.full_name ?? "");
    });
    // Load phone/district from profiles
    supabase.auth.getUser().then(({ data: authRes }) => {
      if (!authRes.user) return;
      const userId = authRes.user.id;
      supabase
        .from("profiles")
        .select("phone,district")
        .eq("id", userId)
        .maybeSingle()
        .then(({ data: p }) => {
          if (p) {
            const pData = p as { phone: string | null; district: string | null };
            setPhone(pData.phone ?? "");
            setDistrict(pData.district ?? "");
          }
        });
    });
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setSaveError("Not authenticated.");
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        district: district.trim() || null,
      })
      .eq("id", authData.user.id);

    if (error) {
      setSaveError(error.message);
    } else {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (!newPw || newPw.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match.");
      return;
    }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      setPwError(error.message);
    } else {
      setPwSuccess(true);
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => setPwSuccess(false), 3000);
    }
    setPwSaving(false);
  }

  const roleLabel =
    adminUser?.role === "super_admin"
      ? "Super Administrator"
      : adminUser?.role === "officer"
        ? "Verification Officer"
        : "Administrator";

  const inputCls =
    "mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "block text-xs font-medium text-foreground";

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <h1 className="text-xl font-bold text-foreground">My Profile</h1>

      {/* Account summary */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <User className="h-7 w-7 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-foreground">
            {adminUser?.full_name ?? adminUser?.email}
          </p>
          <p className="text-xs text-muted-foreground">{adminUser?.email}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Shield className="h-3 w-3" />
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Edit profile */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Edit Profile</h2>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className={labelCls}>Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Officer Name"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>District</label>
            <input
              type="text"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder="Ahmedabad"
              className={inputCls}
            />
          </div>

          {saveError && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {saveError}
            </div>
          )}
          {saveSuccess && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Profile saved successfully.
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Change Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className={labelCls}>New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Minimum 8 characters"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Confirm New Password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Repeat password"
              className={inputCls}
            />
          </div>

          {pwError && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {pwError}
            </div>
          )}
          {pwSuccess && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Password changed. Use the new password on your next sign-in.
            </div>
          )}

          <button
            type="submit"
            disabled={pwSaving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {pwSaving ? "Updating…" : "Change Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
