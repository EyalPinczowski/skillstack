import { TASK_TYPE_LABEL } from '@skillstack/shared';
import type { ComponentType } from 'react';
import type { TaskType } from '../api/client';
import {
  AdminIcon,
  CheckIcon,
  CircleIcon,
  CourseIcon,
  CvIcon,
  ExamIcon,
  HalfCircleIcon,
  PracticeIcon,
  SkipIcon,
} from '../components/icons';

/** Each task type has a colour, an icon and a label; the label and icon keep colour from being the only signal. */
export const TASK_TYPE_META: Record<
  TaskType,
  { label: string; chip: string; strip: string; Icon: ComponentType }
> = {
  course: {
    label: TASK_TYPE_LABEL.course,
    chip: 'bg-task-course-soft text-task-course',
    strip: 'border-task-course',
    Icon: CourseIcon,
  },
  cert_exam: {
    label: TASK_TYPE_LABEL.cert_exam,
    chip: 'bg-task-exam-soft text-task-exam',
    strip: 'border-task-exam',
    Icon: ExamIcon,
  },
  practice: {
    label: TASK_TYPE_LABEL.practice,
    chip: 'bg-task-practice-soft text-task-practice',
    strip: 'border-task-practice',
    Icon: PracticeIcon,
  },
  admin: {
    label: TASK_TYPE_LABEL.admin,
    chip: 'bg-task-admin-soft text-task-admin',
    strip: 'border-task-admin',
    Icon: AdminIcon,
  },
  cv_update: {
    label: TASK_TYPE_LABEL.cv_update,
    chip: 'bg-task-cv-soft text-task-cv',
    strip: 'border-task-cv',
    Icon: CvIcon,
  },
};

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export const TASK_STATUS_META: Record<TaskStatus, { label: string; Icon: ComponentType }> = {
  pending: { label: 'Not started', Icon: CircleIcon },
  in_progress: { label: 'In progress', Icon: HalfCircleIcon },
  done: { label: 'Done', Icon: CheckIcon },
  skipped: { label: 'Skipped', Icon: SkipIcon },
};
