import type { Meeting, RecordingStatus, ChatMessage } from '../wails'

function go() { return window.go.app.App }

export const meetingAPI = {
  startRecording: (title: string, participants: string[]): Promise<void> =>
    go().StartMeetingRecording(title, participants),

  stopRecording: (): Promise<Meeting> =>
    go().StopMeetingRecording(),

  getRecordingStatus: (): Promise<RecordingStatus> =>
    go().GetRecordingStatus(),

  getMeeting: (meetingID: string): Promise<Meeting> =>
    go().GetMeeting(meetingID),

  listMeetings: (date: string): Promise<Meeting[]> =>
    go().ListMeetings(date),

  refineMeeting: (meetingID: string, message: string): Promise<string> =>
    go().RefineMeetingNote(meetingID, message),

  getRefinementChat: (meetingID: string): Promise<ChatMessage[]> =>
    go().GetMeetingRefinementChat(meetingID),

  getMeetingByPageID: (pageID: string): Promise<Meeting> =>
    go().GetMeetingByPageID(pageID),
}
