import useSWR from "swr";
import { listSchedules, cancelSchedule, editSchedule } from "@/utils/scheduler";

export const useSchedules = () => {
  const { data, mutate } = useSWR("schedules", listSchedules);

  return {
    schedules: data?.jobs || [],
    refetch  : () => mutate(),
    cancel   : async (jobId) => { await cancelSchedule(jobId); mutate(); },
    edit     : async (payload)  => { await editSchedule(payload); mutate(); },
  };
};
