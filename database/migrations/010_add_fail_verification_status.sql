-- GrainShield AI
-- Migration 010: Add explicit FAIL verification status

ALTER TYPE public.verification_status
ADD VALUE IF NOT EXISTS 'fail' AFTER 'pass';