import type { StateCreator } from 'zustand'
import type { AppState, RecordingSlice } from './types'
import { meetingAPI } from '../bridge/api/meeting'

export const createRecordingSlice: StateCreator<AppState, [], [], RecordingSlice> = (set, get) => ({
    recordingActive: false,
    recordingMeetingId: null,
    recordingTitle: null,
    recordingStartedAt: null,
    recordingError: null,
    recordingFileSizeMb: 0,
    recordingAudioLevel: 0,
    processingStatus: null,
    processingTitle: null,
    processingMeetingId: null,
    processingError: null,
    recordingCompletedTitle: null,
    recordingCompletedMeetingId: null,
    showRecordingForm: false,

    openRecordingForm: () => set({ showRecordingForm: true }),
    closeRecordingForm: () => set({ showRecordingForm: false }),

    startRecording: async (title: string, participants: string[]) => {
        try {
            await meetingAPI.startRecording(title, participants)
            set({
                recordingActive: true,
                recordingTitle: title,
                recordingStartedAt: new Date().toISOString(),
                recordingError: null,
                recordingCompletedTitle: null,
                recordingCompletedMeetingId: null,
            })
        } catch (e: any) {
            set({ recordingError: e?.message || 'Failed to start recording' })
        }
    },

    stopRecording: async () => {
        const titleBefore = get().recordingTitle
        try {
            const meeting = await meetingAPI.stopRecording()
            set({
                recordingActive: false,
                recordingMeetingId: null,
                recordingTitle: null,
                recordingStartedAt: null,
                recordingFileSizeMb: 0,
                recordingAudioLevel: 0,
                recordingCompletedTitle: meeting?.title || titleBefore,
                recordingCompletedMeetingId: meeting?.id || null,
            })
        } catch (e: any) {
            set({
                recordingActive: false,
                recordingError: e?.message || 'Failed to stop recording',
            })
        }
    },

    pollRecordingStatus: async () => {
        try {
            const status = await meetingAPI.getRecordingStatus()
            if (status.active) {
                set({
                    recordingActive: true,
                    recordingMeetingId: status.meetingId,
                    recordingTitle: status.title,
                    recordingStartedAt: status.startedAt,
                    recordingFileSizeMb: status.fileSizeMb,
                    recordingAudioLevel: status.audioLevel,
                    recordingError: status.error || null,
                })
            } else {
                set({
                    recordingActive: false,
                })
            }
        } catch {
            // Polling failure is non-fatal
        }
    },

    dismissCompleted: () => set({
        recordingCompletedTitle: null,
        recordingCompletedMeetingId: null,
    }),
})
