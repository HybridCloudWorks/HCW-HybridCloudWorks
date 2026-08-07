import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublishTargetForItem } from '@/lib/contentModel';
import { usePublicData } from '@/hooks/usePublicData';
import { getJSON } from '@/lib/api';
import { saveContentSchedule } from '@/lib/contentWorkflow';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCoverImageUrl } from '@/lib/blogUtils';
import { useToast } from '@/components/ui/use-toast';
import { Calendar, ChevronLeft, ChevronRight, Clock, Share2, X } from 'lucide-react';
import { ToastAction } from '@/components/ui/toast';

// Helper to format date for calendar display
const formatDate = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

// Helper to format time
const formatTime = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

// Generate calendar days for a month
const generateCalendarDays = (year, month) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from Sunday

  const days = [];
  const currentDate = new Date(startDate);

  while (currentDate <= lastDay || currentDate.getDay() !== 0) {
    days.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
    if (days.length > 42) break; // Max 6 weeks
  }

  return days;
};

// Helper to check if dates are same day
const isSameDay = (date1, date2) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

const getPublishTargetLabel = (item) => {
  const target = getPublishTargetForItem(item);
  if (target === 'coder_corner') return 'code';
  if (target === 'architecture') return 'architecture';
  return target;
};

const getQueueStatusLabel = (item) => {
  if (item.Live) {
    return item.contentStatus?.replace(/_/g, ' ') || 'published';
  }

  const target = getPublishTargetLabel(item);
  if (item.scheduledPublishDate) {
    return `scheduled ${target}`;
  }
  return `ready ${target}`;
};

function toScheduledDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: allContentRaw, loading } = usePublicData(
    () => getJSON('cms/content?limit=500').then((res) => res.items || []),
    'calendar:content'
  );
  const { data: socialPostsRaw } = usePublicData(
    () => getJSON('cms/social-posts?status=all&limit=100').then((res) => res.items || []),
    'calendar:social'
  );
  const allContent = allContentRaw || [];
  const socialPosts = socialPostsRaw || [];
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // Modal state for scheduling
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [schedulingDate, setSchedulingDate] = useState(null);
  const [selectedContentForScheduling, setSelectedContentForScheduling] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  // Time-of-day picker (defaults to 09:00 local)
  const [scheduleTime, setScheduleTime] = useState('09:00');

  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (!showSchedulingModal) return undefined;

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setShowSchedulingModal(false);
        setSelectedContentForScheduling(null);
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showSchedulingModal]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const calendarDays = generateCalendarDays(year, month);

  // Get scheduled content (only publish-queue items with scheduledPublishDate)
  const scheduledContent = allContent.filter((item) => {
    const status = item.contentStatus || '';
    if (!item.scheduledPublishDate || item.Live) return false;
    if (status === 'rejected' || status === 'archived') return false;
    return (
      status.startsWith('published_') ||
      status.includes('approved') ||
      status === 'ready_to_publish'
    );
  });

  // Group content by date (scheduledPublishDate is an ISO string from the
  // API; tolerate legacy Timestamp objects during migration)
  const contentByDate = scheduledContent.reduce((acc, item) => {
    const date = toScheduledDate(item.scheduledPublishDate);
    if (date) {
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(item);
    }
    return acc;
  }, {});

  // Get publish-ready content (pending live publish or approved legacy states)
  const instantPublishContent = allContent.filter((item) => {
    const status = item.contentStatus || '';
    const isLive = item.Live === true;
    const hasSchedule = Boolean(item.scheduledPublishDate);

    // Exclude only items that are already live or not eligible
    if (isLive || status === 'rejected' || status === 'archived') {
      return false;
    }

    // Scheduled items belong only in the calendar date buckets
    if (hasSchedule) {
      return false;
    }

    // Include content staged as published (pending live) and approved legacy states
    if (status.startsWith('published_') || status.includes('approved')) {
      return true;
    }

    return false;
  });

  const totalQueueCount = new Set([
    ...scheduledContent.map((item) => item.id),
    ...instantPublishContent.map((item) => item.id),
  ]).size;

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getItemsForDay = (day) => {
    const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    return contentByDate[dayKey] || [];
  };

  const isToday = (day) => isSameDay(day, new Date());
  const isCurrentMonth = (day) => day.getMonth() === month;

  // Handle double-click on a date to open scheduling modal
  const handleDateDoubleClick = (day) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day < today) {
      toast({
        title: 'Cannot schedule in the past',
        description: 'Please select today or a future date.',
        variant: 'destructive',
      });
      return;
    }
    setSchedulingDate(day);
    setSelectedContentForScheduling(null);
    setShowSchedulingModal(true);
  };

  // Handle double-click on content item to show time slots
  const handleContentDoubleClick = (content) => {
    setSelectedContentForScheduling(content);
  };

  // Schedule the selected content at a specific local hour/minute.
  const scheduleAt = async (hour, minute = 0) => {
    if (!selectedContentForScheduling || !schedulingDate) return;

    setScheduling(true);
    try {
      const scheduleDateTime = new Date(schedulingDate);
      scheduleDateTime.setHours(hour, minute, 0, 0);
      await saveContentSchedule({
        contentId: selectedContentForScheduling.id,
        instantPublish: false,
        scheduledPublishDate: scheduleDateTime.toISOString(),
        publishTarget: getPublishTargetForItem(selectedContentForScheduling),
      });

      toast({
        title: 'Scheduled',
        description: `Scheduled for ${formatDate(scheduleDateTime)} at ${formatTime(scheduleDateTime)} (${browserTimeZone})`,
        action: (
          <ToastAction
            altText="Schedule social post"
            onClick={() => navigate('/admin/social?tab=compose')}
          >
            Schedule Social
          </ToastAction>
        ),
      });
      setShowSchedulingModal(false);
      setSelectedContentForScheduling(null);
    } catch (err) {
      console.error('Scheduling error:', err);
      toast({
        title: 'Scheduling failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setScheduling(false);
    }
  };

  // Handle double-click on hour to schedule content (legacy hour grid)
  const handleHourDoubleClick = (hour) => scheduleAt(hour, 0);

  // Time-of-day picker submit
  const handleScheduleAtPickedTime = () => {
    const [h, m] = String(scheduleTime || '09:00')
      .split(':')
      .map((v) => Number(v));
    if (!Number.isFinite(h)) return;
    scheduleAt(h, Number.isFinite(m) ? m : 0);
  };

  const handleDragStart = (item, event) => {
    event.dataTransfer.setData('text/content-id', item.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnDay = async (day, event) => {
    event.preventDefault();
    const contentId = event.dataTransfer.getData('text/content-id');
    if (!contentId) return;

    const droppedItem = instantPublishContent.find((item) => item.id === contentId);
    if (!droppedItem) return;

    try {
      const scheduleDateTime = new Date(day);
      scheduleDateTime.setHours(9, 0, 0, 0);
      await saveContentSchedule({
        contentId,
        instantPublish: false,
        scheduledPublishDate: scheduleDateTime.toISOString(),
        publishTarget: getPublishTargetForItem(droppedItem),
      });
    } catch (err) {
      console.error('Drag-drop scheduling error:', err);
      toast({
        title: 'Scheduling failed',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-slate-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Publishing Calendar</h1>
        <p className="text-muted-foreground">
          Schedule content for future publication or publish instantly
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar View (3 cols) */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
                    currentDate
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={goToToday}>
                    Today
                  </Button>
                  <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={goToNextMonth}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-2">
                {/* Day headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div
                    key={day}
                    className="text-center text-xs font-semibold text-muted-foreground py-2"
                  >
                    {day}
                  </div>
                ))}

                {/* Calendar days */}
                {calendarDays.map((day, idx) => {
                  const dayItems = getItemsForDay(day);
                  const hasItems = dayItems.length > 0;
                  const isTodayDate = isToday(day);
                  const isInCurrentMonth = isCurrentMonth(day);

                  return (
                    <div
                      key={idx}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedDate(day)}
                      onDoubleClick={() => handleDateDoubleClick(day)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDropOnDay(day, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedDate(day);
                        }
                      }}
                      className={`
                        min-h-24 p-2 border rounded-lg cursor-pointer transition-colors
                        ${isTodayDate ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : ''}
                        ${hasItems ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : ''}
                        ${!isInCurrentMonth ? 'opacity-40' : ''}
                        ${selectedDate && isSameDay(day, selectedDate) ? 'ring-2 ring-slate-blue' : ''}
                        hover:bg-muted/50
                      `}
                    >
                      <div className="text-sm font-medium mb-1">{day.getDate()}</div>
                      {hasItems && (
                        <div className="space-y-1">
                          {dayItems.slice(0, 2).map((item) => (
                            <div
                              key={item.id}
                              role="button"
                              tabIndex={0}
                              className="text-xs p-1 bg-white dark:bg-slate-800 rounded border truncate"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/admin/queue/${item.id}?source=content`);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  navigate(`/admin/queue/${item.id}?source=content`);
                                }
                              }}
                            >
                              {item.Title || item.title || 'Untitled'}
                            </div>
                          ))}
                          {dayItems.length > 2 && (
                            <div className="text-xs text-muted-foreground">
                              +{dayItems.length - 2} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar (1 col) */}
        <div className="space-y-4">
          {/* Instant Publish Queue */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Ready to Publish ({instantPublishContent.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {instantPublishContent.length === 0 ? (
                <p className="text-xs text-muted-foreground">No items ready for scheduling</p>
              ) : (
                <div className="space-y-2">
                  {instantPublishContent.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      draggable
                      role="button"
                      tabIndex={0}
                      onDragStart={(e) => handleDragStart(item, e)}
                      onClick={() => navigate(`/admin/queue/${item.id}?source=content`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/admin/queue/${item.id}?source=content`);
                        }
                      }}
                      className="p-2 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <p className="text-xs font-medium truncate">
                        {item.Title || item.title || 'Untitled'}
                      </p>
                      <Badge variant="secondary" className="text-xs mt-1">
                        {getQueueStatusLabel(item)}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Drag to calendar date to schedule at 9:00 AM
                      </p>
                    </div>
                  ))}
                  {instantPublishContent.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      +{instantPublishContent.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected Date Details */}
          {selectedDate && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{formatDate(selectedDate)}</CardTitle>
              </CardHeader>
              <CardContent>
                {getItemsForDay(selectedDate).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No scheduled items</p>
                ) : (
                  <div className="space-y-2">
                    {getItemsForDay(selectedDate).map((item) => {
                      const coverUrl = getCoverImageUrl(item);
                      const scheduledTime = toScheduledDate(item.scheduledPublishDate);

                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => navigate(`/admin/queue/${item.id}?source=content`)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              navigate(`/admin/queue/${item.id}?source=content`);
                            }
                          }}
                          className="p-2 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          {coverUrl && (
                            <img
                              src={coverUrl}
                              alt=""
                              className="w-full h-16 object-cover rounded mb-2"
                            />
                          )}
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-xs font-medium line-clamp-2">
                              {item.Title || item.title || 'Untitled'}
                            </p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              title="Schedule social post"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/admin/social?tab=compose');
                              }}
                            >
                              <Share2 className="h-3 w-3" />
                            </Button>
                          </div>
                          {scheduledTime && (
                            <p className="text-xs text-muted-foreground mt-1">
                              <Clock className="h-3 w-3 inline mr-1" />
                              {formatTime(scheduledTime)}
                            </p>
                          )}
                          <Badge variant="outline" className="text-xs mt-1">
                            {item['Cloud Provider'] || item.cloudProvider || 'Unknown'}
                          </Badge>
                          <Badge variant="secondary" className="text-xs mt-1 ml-2">
                            {getQueueStatusLabel(item)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scheduled:</span>
                <span className="font-medium">{scheduledContent.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Instant Ready:</span>
                <span className="font-medium">{instantPublishContent.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Queue:</span>
                <span className="font-medium">{totalQueueCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Social Posts:</span>
                <span className="font-medium">{socialPosts.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Glassmorphic Scheduling Modal */}
      {showSchedulingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          {/* Backdrop overlay - click to close */}
          <div
            className="absolute inset-0"
            onClick={() => {
              setShowSchedulingModal(false);
              setSelectedContentForScheduling(null);
            }}
            aria-hidden="true"
          />

          {/* Modal content */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduling-modal-title"
            tabIndex={-1}
            className="relative w-full max-w-4xl max-h-[80vh] overflow-auto rounded-2xl border border-white/20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl"
          >
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-white/20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl">
              <div>
                <h2 id="scheduling-modal-title" className="text-2xl font-bold">
                  Schedule for {schedulingDate && formatDate(schedulingDate)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedContentForScheduling
                    ? 'Double-click an hour to schedule'
                    : 'Double-click content to select time'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowSchedulingModal(false);
                  setSelectedContentForScheduling(null);
                }}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {!selectedContentForScheduling ? (
                // Show all publishable content
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">
                    Available Content ({instantPublishContent.length})
                  </h3>
                  {instantPublishContent.length === 0 ? (
                    <p className="text-muted-foreground">No content available for scheduling</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {instantPublishContent.map((item) => {
                        const coverUrl = getCoverImageUrl(item);
                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            className="group p-4 border-2 border-white/40 rounded-xl bg-white/60 dark:bg-slate-800/60 hover:bg-white/80 dark:hover:bg-slate-800/80 cursor-pointer transition-all hover:shadow-lg"
                            onDoubleClick={() => handleContentDoubleClick(item)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleContentDoubleClick(item);
                              }
                            }}
                          >
                            {coverUrl && (
                              <img
                                src={coverUrl}
                                alt=""
                                className="w-full h-32 object-cover rounded-lg mb-3"
                              />
                            )}
                            <h4 className="font-semibold text-base line-clamp-2 mb-2">
                              {item.Title || item.title || 'Untitled'}
                            </h4>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                              {item.Summary || item.summary || 'No summary'}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">
                                {item['Cloud Provider'] || item.cloudProvider || 'Unknown'}
                              </Badge>
                              <Badge variant="secondary">{getQueueStatusLabel(item)}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              Double-click to select time
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                // Show time slots for selected content
                <div className="space-y-6">
                  {/* Selected Content Preview */}
                  <div className="p-4 border-2 border-blue-500/40 rounded-xl bg-blue-50/60 dark:bg-blue-950/60">
                    <div className="flex items-start gap-4">
                      {getCoverImageUrl(selectedContentForScheduling) && (
                        <img
                          src={getCoverImageUrl(selectedContentForScheduling)}
                          alt=""
                          className="w-24 h-24 object-cover rounded-lg shrink-0"
                        />
                      )}
                      <div className="flex-1">
                        <h4 className="font-semibold text-lg mb-1">
                          {selectedContentForScheduling.Title ||
                            selectedContentForScheduling.title ||
                            'Untitled'}
                        </h4>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {selectedContentForScheduling.Summary ||
                            selectedContentForScheduling.summary ||
                            ''}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedContentForScheduling(null)}
                      >
                        Change
                      </Button>
                    </div>
                  </div>

                  {/* Same-day cluster warning */}
                  {schedulingDate && getItemsForDay(schedulingDate).length >= 3 && (
                    <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                      <strong>{getItemsForDay(schedulingDate).length} items</strong> are already
                      scheduled on this day. Adding more than 3 posts to a single day can crowd your
                      audience — consider spreading them out.
                    </div>
                  )}

                  {/* Exact time-of-day picker */}
                  <div className="flex flex-wrap items-end gap-3 p-4 border-2 border-white/40 rounded-xl bg-white/60 dark:bg-slate-800/60">
                    <div>
                      <label
                        htmlFor="calendar-schedule-time"
                        className="block text-sm font-semibold mb-1"
                      >
                        Time of day
                      </label>
                      <input
                        id="calendar-schedule-time"
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="h-10 rounded-lg border bg-background px-3 text-sm"
                      />
                    </div>
                    <Button onClick={handleScheduleAtPickedTime} disabled={scheduling}>
                      Schedule at {scheduleTime}
                    </Button>
                    <p className="text-xs text-muted-foreground basis-full">
                      Times are in your browser timezone: <strong>{browserTimeZone}</strong>
                    </p>
                  </div>

                  {/* Time Slots Grid */}
                  <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Or pick an hour (double-click to schedule)
                    </h3>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                      {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                        const isPastHour =
                          schedulingDate &&
                          isSameDay(schedulingDate, new Date()) &&
                          hour < new Date().getHours();

                        return (
                          <button
                            key={hour}
                            disabled={isPastHour || scheduling}
                            onDoubleClick={() => handleHourDoubleClick(hour)}
                            className={`
                              p-4 rounded-xl border-2 font-semibold text-lg transition-all
                              ${isPastHour ? 'opacity-40 cursor-not-allowed border-gray-300 bg-gray-100 dark:bg-gray-800' : 'border-white/40 bg-white/60 dark:bg-slate-800/60 hover:bg-green-100 dark:hover:bg-green-900 hover:border-green-500 cursor-pointer hover:shadow-lg'}
                              ${scheduling ? 'opacity-50 cursor-wait' : ''}
                            `}
                          >
                            {hour.toString().padStart(2, '0')}:00
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                      Double-click a time slot to schedule this content
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
