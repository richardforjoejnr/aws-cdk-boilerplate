import axios from 'axios';
import { Upload, DashboardData, HistoricalData } from '../types';

// This will be set from environment variable or CloudFormation output
const API_BASE_URL = (import.meta.env.VITE_JIRA_API_URL as string | undefined) || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const jiraApi = {
  // Get presigned URL for CSV upload
  getUploadUrl: async (fileName: string, description?: string) => {
    const response = await api.post<{ uploadId: string; presignedUrl: string }>('/uploads', {
      fileName,
      description,
    });
    return response.data;
  },

  // Upload CSV file to S3 using presigned URL
  uploadCsvFile: async (presignedUrl: string, file: File) => {
    await axios.put(presignedUrl, file, {
      headers: {
        'Content-Type': 'text/csv',
      },
    });
  },

  // List all uploads
  listUploads: async () => {
    const response = await api.get<{ uploads: Upload[]; count: number }>('/uploads');
    return response.data;
  },

  // Get dashboard data for a specific upload
  getDashboardData: async (uploadId: string) => {
    const response = await api.get<DashboardData>(`/dashboard/${uploadId}`);
    return response.data;
  },

  // Get historical trend data
  getHistoricalData: async () => {
    const response = await api.get<HistoricalData>('/historical');
    return response.data;
  },
};

export default jiraApi;
