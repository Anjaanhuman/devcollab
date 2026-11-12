import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Hash, MessageCircle, Search, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';
import { createSocket } from '../services/socket.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

const idOf = (value) => String(value?._id ?? value?.id ?? value ?? '');
const sameConversation = (message, selected, userId) => selected?.kind === 'direct' && [idOf(message.sender), idOf(message.recipient)].sort().join(':') === [String(userId), selected.id].sort().join(':');

export default function MessagesPage() {
  const { user } = useAuth();
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [online, setOnline] = useState({});
  const [loading, setLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('connecting');
  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/messages/people'), api.get('/projects', { params: { limit: 100 } })]).then(([peopleResponse, projectResponse]) => {
      if (!active) return;
      setPeople(peopleResponse.data.data);
      setProjects(projectResponse.data.data.filter((project) => String(project.owner?._id) === String(user?.id) || project.members?.some((member) => String(member.user?._id) === String(user?.id))));
    }).catch((requestError) => { if (active) setError(getMessage(requestError)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', (socketError) => { setConnection('offline'); setError(socketError.message || 'Live messaging is unavailable.'); });
    socket.on('presence:update', ({ userId, online: isOnline }) => setOnline((current) => ({ ...current, [userId]: isOnline })));
    socket.on('chat:direct:message', (message) => {
      if (sameConversation(message, selected, user?.id)) {
        setMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message]);
        if (idOf(message.recipient) === user?.id) socket.emit('chat:message:read', { messageId: message._id });
      }
    });
    socket.on('chat:project:message', (message) => {
      if (selected?.kind === 'project' && idOf(message.project) === selected.id) {
        setMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message]);
        if (idOf(message.sender) !== user?.id) socket.emit('chat:message:read', { messageId: message._id });
      }
    });
    socket.connect();
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [user?.id, selected?.kind, selected?.id]);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    let active = true;
    setConversationLoading(true); setError('');
    const path = selected.kind === 'project' ? `/messages/project/${selected.id}` : `/messages/direct/${selected.id}`;
    api.get(path, { params: { limit: 100 } }).then(({ data }) => {
      if (active) setMessages(data.data);
      if (selected.kind === 'project') socketRef.current?.emit('chat:project:join', { projectId: selected.id }, (result) => { if (!result?.success) setError(result?.message || 'Could not join the project chat.'); });
    }).catch((requestError) => { if (active) setError(getMessage(requestError)); }).finally(() => { if (active) setConversationLoading(false); });
    return () => { active = false; };
  }, [selected?.kind, selected?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages]);

  function selectPerson(person) { setSelected({ kind: 'direct', id: idOf(person), name: person.fullName || person.username, user: person }); }
  function selectProject(project) { setSelected({ kind: 'project', id: idOf(project), name: project.title, project }); }

  function sendMessage(event) {
    event.preventDefault();
    const body = text.trim();
    if (!selected || !body || !socketRef.current?.connected) return;
    const eventName = selected.kind === 'project' ? 'chat:project:send' : 'chat:direct:send';
    const payload = selected.kind === 'project' ? { projectId: selected.id, body } : { recipientId: selected.id, body };
    socketRef.current.emit(eventName, payload, (result) => {
      if (!result?.success) setError(result?.message || 'Message could not be sent.');
      else setText('');
    });
  }

  const matchingPeople = people.filter((person) => `${person.fullName} ${person.username}`.toLowerCase().includes(search.toLowerCase()));
  const matchingProjects = projects.filter((project) => project.title.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <LoadingState label="Loading conversations…" />;
  return <div className="messages-layout panel"><aside className="conversation-sidebar"><div className="conversation-heading"><div><span className="eyebrow">YOUR TEAM</span><h2>Messages</h2></div><span className={`live-indicator ${connection}`} title={connection}>{connection === 'connected' ? 'Live' : 'Offline'}</span></div><label className="conversation-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or teams" /></label><div className="conversation-list"><span className="sidebar-label">DIRECT</span>{matchingPeople.length ? matchingPeople.map((person) => <button key={person._id} className={`conversation-item${selected?.kind === 'direct' && selected.id === idOf(person) ? ' conversation-active' : ''}`} onClick={() => selectPerson(person)}><span className="avatar avatar-small">{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : (person.fullName?.[0] || person.username?.[0]).toUpperCase()}</span><span><strong>{person.fullName || person.username}</strong><small>@{person.username}</small></span><i className={online[idOf(person)] ? 'online-dot' : 'offline-dot'} /></button>) : <p className="conversation-empty">No other developers yet.</p>}<span className="sidebar-label sidebar-label-gap">PROJECT CHANNELS</span>{matchingProjects.length ? matchingProjects.map((project) => <button key={project._id} className={`conversation-item${selected?.kind === 'project' && selected.id === idOf(project) ? ' conversation-active' : ''}`} onClick={() => selectProject(project)}><span className="channel-icon"><Hash size={15} /></span><span><strong>{project.title}</strong><small>{project.members?.length || 1} team members</small></span></button>) : <p className="conversation-empty">No project channels yet.</p>}</div></aside>
    <section className="conversation-main"><div className="conversation-topline">{selected ? <><span className={selected.kind === 'project' ? 'channel-icon' : 'avatar avatar-small'}>{selected.kind === 'project' ? <Hash size={15} /> : selected.user?.avatarUrl ? <img src={selected.user.avatarUrl} alt="" /> : selected.name[0]?.toUpperCase()}</span><span><strong>{selected.name}</strong><small>{selected.kind === 'project' ? 'Project channel' : online[selected.id] ? 'Online now' : selected.user?.lastSeenAt ? `Last active ${new Date(selected.user.lastSeenAt).toLocaleDateString()}` : 'Direct message'}</small></span>{selected.kind === 'project' && <span className="conversation-members"><Users size={14} /> {selected.project?.members?.length || 1}</span>}</> : <><MessageCircle size={17} /><span><strong>Your conversations</strong><small>Select a person or project channel.</small></span></>}</div>
      {error && <div className="chat-error" role="alert">{error}</div>}
      <div className="message-history">{!selected ? <EmptyState title="Pick up a conversation" description="Choose a developer or project channel from the left." /> : conversationLoading ? <LoadingState label="Loading messages…" /> : messages.length ? messages.map((message) => { const mine = idOf(message.sender) === user?.id; return <article className={`message-row${mine ? ' message-mine' : ''}`} key={message._id}><span className="avatar avatar-tiny">{message.sender?.avatarUrl ? <img src={message.sender.avatarUrl} alt="" /> : (message.sender?.fullName?.[0] || 'D').toUpperCase()}</span><div className="message-bubble"><div className="message-meta"><strong>{mine ? 'You' : message.sender?.fullName || message.sender?.username}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.body}</p></div></article>; }) : <EmptyState title="Start the conversation" description="Say hello or share what you are working on." />}<div ref={bottomRef} /></div>
      {selected && <form className="message-composer" onSubmit={sendMessage}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={connection === 'connected' ? 'Write a message…' : 'Reconnecting to chat…'} maxLength={5000} rows={2} disabled={connection !== 'connected'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} /><button className="button" disabled={connection !== 'connected' || !text.trim()} aria-label="Send message"><ArrowUp size={17} /></button><small>Enter to send · Shift + Enter for a new line</small></form>}
    </section></div>;
}
