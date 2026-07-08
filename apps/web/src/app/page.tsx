"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type Contact = {
  id: number;
  userId: string;
  name: string;
  phone: string;
  relationship?: string;
  createdAt: string;
};

type Incident = {
  id: number;
  userId: string;
  incidentType: string;
  description: string;
  latitude: number;
  longitude: number;
  createdAt: string;
};

type Responder = {
  id: number;
  name: string;
  responderType: "ambulance" | "police" | "volunteer";
  latitude: number;
  longitude: number;
  phone: string;
  distanceKm: number;
};

type LocationUpdate = {
  id: number;
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  createdAt: string;
};

const LiveMap = dynamic(() => import("@/components/LiveMap").then((mod) => mod.LiveMap), {
  ssr: false,
});

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const defaultUserId = process.env.NEXT_PUBLIC_DEFAULT_USER_ID ?? "demo-user";
const locationPushIntervalMs = Number(
  process.env.NEXT_PUBLIC_LOCATION_PUSH_INTERVAL_MS ?? "15000",
);
const geolocationSupported =
  typeof navigator !== "undefined" ? Boolean(navigator.geolocation) : true;

const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error ?? "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export default function Home() {
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [lastLocationUpdate, setLastLocationUpdate] = useState<LocationUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);

  const [contactForm, setContactForm] = useState({ name: "", phone: "", relationship: "" });
  const [incidentForm, setIncidentForm] = useState({
    description: "",
    latitude: "",
    longitude: "",
  });

  const socketRef = useRef<Socket | null>(null);
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const refreshContacts = useCallback(async () => {
    const data = await fetchJson<Contact[]>(`/api/contacts?userId=${defaultUserId}`);
    setContacts(data);
  }, []);

  const refreshResponders = useCallback(
    async (latitude: number, longitude: number) => {
      const data = await fetchJson<Responder[]>(
        `/api/responders/nearby?latitude=${latitude}&longitude=${longitude}&radiusKm=15`,
      );
      setResponders(data);
    },
    [],
  );

  const sendLocationUpdate = useCallback(
    async (latitude: number, longitude: number, accuracy?: number) => {
      const update = await fetchJson<LocationUpdate>("/api/location-updates", {
        method: "POST",
        body: JSON.stringify({ userId: defaultUserId, latitude, longitude, accuracy }),
      });
      setLastLocationUpdate(update);
    },
    [],
  );

  useEffect(() => {
    Promise.all([
      fetchJson<Contact[]>(`/api/contacts?userId=${defaultUserId}`),
      fetchJson<Incident[]>("/api/incidents?limit=20"),
    ])
      .then(([contactData, incidentData]) => {
        setContacts(contactData);
        setIncidents(incidentData);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Failed to load initial data");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setLocation(nextLocation);
        locationRef.current = nextLocation;
        setIncidentForm((previous) => ({
          ...previous,
          latitude: String(nextLocation.latitude),
          longitude: String(nextLocation.longitude),
        }));

        await refreshResponders(nextLocation.latitude, nextLocation.longitude);
      },
      (geoError) => {
        setError(`Location permission error: ${geoError.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
    );

    const intervalId = window.setInterval(() => {
      if (!locationRef.current) {
        return;
      }
      void sendLocationUpdate(locationRef.current.latitude, locationRef.current.longitude);
    }, locationPushIntervalMs);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(intervalId);
    };
  }, [refreshResponders, sendLocationUpdate]);

  useEffect(() => {
    const socket = io(apiBaseUrl);
    socketRef.current = socket;

    socket.on("incident:created", (incident: Incident) => {
      setIncidents((previous) => [incident, ...previous].slice(0, 20));
    });

    socket.on("location:updated", (update: LocationUpdate) => {
      if (update.userId === defaultUserId) {
        setLastLocationUpdate(update);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const submitSOS = async () => {
    if (!location) {
      setError("Location is required before triggering SOS.");
      return;
    }

    setError(null);
    await fetchJson<Incident>("/api/sos", {
      method: "POST",
      body: JSON.stringify({
        userId: defaultUserId,
        latitude: location.latitude,
        longitude: location.longitude,
        description: "SOS emergency triggered from web app",
      }),
    });
  };

  const saveContact = async () => {
    if (!contactForm.name || !contactForm.phone) {
      setError("Contact name and phone are required.");
      return;
    }

    setError(null);

    const payload = {
      userId: defaultUserId,
      name: contactForm.name,
      phone: contactForm.phone,
      relationship: contactForm.relationship || undefined,
    };

    if (editingContactId) {
      await fetchJson<Contact>(`/api/contacts/${editingContactId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await fetchJson<Contact>("/api/contacts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    setEditingContactId(null);
    setContactForm({ name: "", phone: "", relationship: "" });
    await refreshContacts();
  };

  const editContact = (contact: Contact) => {
    setEditingContactId(contact.id);
    setContactForm({
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship ?? "",
    });
  };

  const removeContact = async (contactId: number) => {
    setError(null);
    await fetchJson<void>(`/api/contacts/${contactId}?userId=${defaultUserId}`, {
      method: "DELETE",
    });
    await refreshContacts();
  };

  const reportIncident = async () => {
    const latitude = Number(incidentForm.latitude || location?.latitude);
    const longitude = Number(incidentForm.longitude || location?.longitude);

    if (!incidentForm.description || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setError("Description and valid coordinates are required to report an incident.");
      return;
    }

    setError(null);
    await fetchJson<Incident>("/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        userId: defaultUserId,
        incidentType: "report",
        description: incidentForm.description,
        latitude,
        longitude,
      }),
    });

    setIncidentForm((previous) => ({ ...previous, description: "" }));
  };

  const locationLabel = useMemo(() => {
    if (!location) {
      return "Waiting for location permission...";
    }

    return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  }, [location]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="rounded-xl border bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Road Safety MVP</h1>
        <p className="text-sm text-gray-600">
          Live map, SOS, incidents, emergency contacts, nearby responders, and realtime updates.
        </p>
      </header>

      {error ? <p className="rounded-md bg-red-100 p-3 text-red-700">{error}</p> : null}
      {!geolocationSupported ? (
        <p className="rounded-md bg-yellow-100 p-3 text-yellow-800">
          Geolocation is unavailable in this browser.
        </p>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Live Map (OpenStreetMap + Leaflet)</h2>
            <span className="text-xs text-gray-600">Current: {locationLabel}</span>
          </div>
          <LiveMap location={location} responders={responders} incidents={incidents} />
          <p className="text-xs text-gray-500">
            Nearby responders shown: {responders.length}. Last location sync: {lastLocationUpdate?.createdAt ?? "-"}
          </p>
        </div>

        <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Emergency Actions</h2>
          <button
            onClick={() => void submitSOS()}
            className="w-full rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700"
          >
            🚨 Trigger SOS
          </button>

          <div className="space-y-2 rounded-md border p-3">
            <h3 className="font-medium text-gray-900">Report Incident</h3>
            <textarea
              value={incidentForm.description}
              onChange={(event) =>
                setIncidentForm((previous) => ({ ...previous, description: event.target.value }))
              }
              placeholder="Describe the road incident"
              className="h-24 w-full rounded-md border p-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={incidentForm.latitude}
                onChange={(event) =>
                  setIncidentForm((previous) => ({ ...previous, latitude: event.target.value }))
                }
                className="rounded-md border p-2 text-sm"
                placeholder="Latitude"
              />
              <input
                value={incidentForm.longitude}
                onChange={(event) =>
                  setIncidentForm((previous) => ({ ...previous, longitude: event.target.value }))
                }
                className="rounded-md border p-2 text-sm"
                placeholder="Longitude"
              />
            </div>
            <button
              onClick={() => void reportIncident()}
              className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
            >
              Submit Incident
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Emergency Contacts</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={contactForm.name}
              onChange={(event) => setContactForm((previous) => ({ ...previous, name: event.target.value }))}
              placeholder="Name"
              className="rounded-md border p-2 text-sm"
            />
            <input
              value={contactForm.phone}
              onChange={(event) => setContactForm((previous) => ({ ...previous, phone: event.target.value }))}
              placeholder="Phone"
              className="rounded-md border p-2 text-sm"
            />
            <input
              value={contactForm.relationship}
              onChange={(event) =>
                setContactForm((previous) => ({ ...previous, relationship: event.target.value }))
              }
              placeholder="Relationship"
              className="rounded-md border p-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void saveContact()}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {editingContactId ? "Update Contact" : "Add Contact"}
            </button>
            {editingContactId ? (
              <button
                onClick={() => {
                  setEditingContactId(null);
                  setContactForm({ name: "", phone: "", relationship: "" });
                }}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <ul className="space-y-2">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex items-center justify-between rounded-md border p-2">
                <div>
                  <p className="font-medium text-gray-900">{contact.name}</p>
                  <p className="text-sm text-gray-600">
                    {contact.phone} {contact.relationship ? `• ${contact.relationship}` : ""}
                  </p>
                </div>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => editContact(contact)} className="rounded border px-2 py-1">
                    Edit
                  </button>
                  <button
                    onClick={() => void removeContact(contact.id)}
                    className="rounded border border-red-200 px-2 py-1 text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!contacts.length && !loading ? (
              <li className="text-sm text-gray-500">No contacts added yet.</li>
            ) : null}
          </ul>
        </div>

        <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Recent Incidents</h2>
          <ul className="space-y-2">
            {incidents.map((incident) => (
              <li key={incident.id} className="rounded-md border p-2">
                <p className="text-sm font-semibold text-gray-900">{incident.incidentType.toUpperCase()}</p>
                <p className="text-sm text-gray-700">{incident.description}</p>
                <p className="text-xs text-gray-500">
                  {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)} • {new Date(incident.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
            {!incidents.length && !loading ? (
              <li className="text-sm text-gray-500">No incidents reported yet.</li>
            ) : null}
          </ul>
        </div>
      </section>
    </main>
  );
}
