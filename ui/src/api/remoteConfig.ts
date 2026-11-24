import type { ResultAsync } from "neverthrow";
import { request, requestText, type ApiError, type TextReply } from "./client";

export type RemoteConfigVersion = {
  versionNumber: string;
  updateTime?: string;
  updateOrigin?: string;
  updateType?: string;
  description?: string;
  rollbackSource?: string;
};

export type RemoteConfigParameterValue = {
  value?: string;
  useInAppDefault?: boolean;
};

export type RemoteConfigParameter = {
  defaultValue?: RemoteConfigParameterValue;
  conditionalValues?: Record<string, RemoteConfigParameterValue>;
  description?: string;
  valueType?: string;
};

export type RemoteConfigCondition = {
  name: string;
  expression: string;
  tagColor?: string;
};

export type RemoteConfigTemplate = {
  conditions?: RemoteConfigCondition[];
  parameters?: Record<string, RemoteConfigParameter>;
  parameterGroups?: Record<
    string,
    { description?: string; parameters?: Record<string, RemoteConfigParameter> }
  >;
  version?: RemoteConfigVersion;
};

const base = (project: string) =>
  `remoteconfig/v1/projects/${encodeURIComponent(project)}/remoteConfig`;

export const getRemoteConfigTemplate = (
  project: string,
  versionNumber?: string,
): ResultAsync<TextReply, ApiError> =>
  requestText(
    "GET",
    versionNumber
      ? `${base(project)}?versionNumber=${encodeURIComponent(versionNumber)}`
      : base(project),
  );

export const validateRemoteConfigTemplate = (
  project: string,
  source: string,
  ifMatch: string,
): ResultAsync<TextReply, ApiError> =>
  requestText("PUT", `${base(project)}?validateOnly=true`, source, false, {
    "if-match": ifMatch,
  });

export const publishRemoteConfigTemplate = (
  project: string,
  source: string,
  ifMatch: string,
): ResultAsync<TextReply, ApiError> =>
  requestText("PUT", base(project), source, false, { "if-match": ifMatch });

export const listRemoteConfigVersions = (
  project: string,
): ResultAsync<{ versions?: RemoteConfigVersion[]; nextPageToken?: string }, ApiError> =>
  request("GET", `${base(project)}:listVersions?pageSize=100`);

export const rollbackRemoteConfig = (
  project: string,
  versionNumber: string,
): ResultAsync<RemoteConfigTemplate, ApiError> =>
  request("POST", `${base(project)}:rollback`, { versionNumber });
