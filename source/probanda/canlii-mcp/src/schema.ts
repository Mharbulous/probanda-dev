import { z } from "zod";

export const CaseIdSchema = z.record(z.string(), z.string());

export const CaseSchema = z.object({
    databaseId: z.string(),
    caseId: CaseIdSchema,
    title: z.string(),
    citation: z.string(),
    aiContentId: z.record(z.string(), z.string()).optional(),
}).passthrough();

export const CitedCasesResponseSchema = z.object({
    citedCases: z.array(CaseSchema),
}).passthrough();

export const CitingCasesResponseSchema = z.object({
    citingCases: z.array(CaseSchema),
}).passthrough();

export const LegislationMetadataContentSchema = z.object({
    partId: z.string(),
    partName: z.string(),
}).passthrough();

export const LegislationMetadataSchema = z.object({
    legislationId: z.string(),
    url: z.string(),
    title: z.string(),
    citation: z.string(),
    language: z.string().optional(),
    dateScheme: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    repealed: z.string().optional(),
    content: z.array(LegislationMetadataContentSchema).optional(),
}).passthrough();

export const LegislationSchema = z.object({
    databaseId: z.string(),
    type: z.string(),
    jurisdiction: z.string(),
    name: z.string(),
}).passthrough();

export const LegislationResponseSchema = z.object({
    legislationDatabases: z.array(LegislationSchema),
}).passthrough();

export const LegislationItemSchema = z.object({
    databaseId: z.string(),
    legislationId: z.string(),
    title: z.string(),
    citation: z.string(),
    type: z.string(),
}).passthrough();

export const LegislationItemResponseSchema = z.object({
    legislations: z.array(LegislationItemSchema),
}).passthrough();

export const CitedLegislationsResponseSchema = z.object({
    citedLegislations: z.array(LegislationItemSchema),
}).passthrough();
