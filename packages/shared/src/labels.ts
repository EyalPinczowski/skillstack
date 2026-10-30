import type { Task } from './schemas';

/** Display names of the task types, used in exports. */
export const TASK_TYPE_LABEL: Record<Task['type'], string> = {
  course: 'Course',
  cert_exam: 'Exam',
  practice: 'Practice',
  admin: 'Admin',
  cv_update: 'CV update',
};
