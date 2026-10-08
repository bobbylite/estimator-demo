import { z } from "zod";

export const UNITS = ["LS", "CY", "LF", "SY", "TON", "EA", "AC", "HR"] as const;
export const STATUSES = ["draft", "review", "submitted"] as const;

export const percentSchema = z
  .number()
  .finite()
  .min(0, "Percent cannot be negative")
  .max(100, "Percent cannot exceed 100");

export const markupsSchema = z.object({
  overheadPercent: percentSchema,
  profitPercent: percentSchema,
  bondPercent: percentSchema,
  contingencyPercent: percentSchema,
});

export const createEstimateSchema = z.object({
  name: z.string().trim().min(1, "Name the estimate").max(160),
  clientName: z.string().trim().min(1, "Enter a client").max(160),
  location: z.string().trim().min(1, "Enter a location").max(160),
  bidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a bid date").optional(),
});

export const updateEstimateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    clientName: z.string().trim().min(1).max(160),
    location: z.string().trim().min(1).max(160),
    bidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    status: z.enum(STATUSES),
    notes: z.string().max(4000),
    overheadPercent: percentSchema,
    profitPercent: percentSchema,
    bondPercent: percentSchema,
    contingencyPercent: percentSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const crewSchema = z.object({
  name: z.string().trim().min(1, "Name the crew").max(120),
  laborRate: z.number().finite().min(0, "Labor rate cannot be negative"),
  equipmentRate: z.number().finite().min(0, "Equipment rate cannot be negative"),
});

export const bidItemSchema = z.object({
  code: z.string().trim().min(1, "Enter an item code").max(32),
  description: z.string().trim().min(1, "Describe the item").max(240),
  quantity: z.number().finite().min(0, "Quantity cannot be negative"),
  unit: z.enum(UNITS),
  crewId: z.string().min(1).nullable(),
  productionRate: z.number().finite().min(0, "Production rate cannot be negative"),
});

export const resourceSchema = z.object({
  kind: z.enum(["material", "subcontractor"]),
  description: z.string().trim().min(1, "Describe the resource").max(160),
  unitCost: z.number().finite().min(0, "Cost cannot be negative"),
  wastePercent: percentSchema,
  pricing: z.enum(["unit", "lump"]),
});

export const passwordBodySchema = z.object({
  loginId: z.string().min(8),
  username: z.string().trim().min(1, "Enter a username").max(200),
  password: z.string().min(1, "Enter a password").max(200),
});

export const otpBodySchema = z.object({
  loginId: z.string().min(8),
  otp: z.string().trim().min(4, "Enter the code").max(12),
});

export const deviceBodySchema = z.object({
  loginId: z.string().min(8),
  deviceId: z.string().trim().min(1).max(80),
});

export const loginIdSchema = z.object({
  loginId: z.string().min(8),
});

export const registerBodySchema = z.object({
  loginId: z.string().min(8),
  username: z.string().trim().min(1, "Enter a username").max(200),
  email: z.email("Enter a valid email").trim().max(200),
  password: z.string().min(1, "Enter a password").max(200),
});

export const pilotToggleSchema = z.object({
  member: z.boolean(),
});

export const runAiSchema = z.object({
  estimateId: z.string().min(8),
});

export const thresholdSchema = z.object({
  threshold: z.number().finite().min(0.5, "Threshold must be at least 50%").max(0.95, "Threshold cannot exceed 95%"),
});

export const verificationBodySchema = z.object({
  loginId: z.string().min(8),
  verificationCode: z.string().trim().min(4, "Enter the verification code").max(32),
});

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
export type CrewInput = z.infer<typeof crewSchema>;
export type BidItemInput = z.infer<typeof bidItemSchema>;
export type ResourceInput = z.infer<typeof resourceSchema>;
