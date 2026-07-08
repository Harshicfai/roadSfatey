"use client";

import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

type Responder = {
  id: number;
  name: string;
  responderType: "ambulance" | "police" | "volunteer";
  latitude: number;
  longitude: number;
  distanceKm: number;
};

type Incident = {
  id: number;
  incidentType: string;
  description: string;
  latitude: number;
  longitude: number;
  createdAt: string;
};

type LiveMapProps = {
  location: { latitude: number; longitude: number } | null;
  responders: Responder[];
  incidents: Incident[];
};

const responderColor = (type: Responder["responderType"]) => {
  if (type === "ambulance") return "#ef4444";
  if (type === "police") return "#2563eb";
  return "#16a34a";
};

export function LiveMap({ location, responders, incidents }: LiveMapProps) {
  const center = location ? [location.latitude, location.longitude] : [12.9716, 77.5946];

  return (
    <MapContainer center={center as [number, number]} zoom={13} className="h-[420px] w-full rounded-xl">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {location ? (
        <CircleMarker center={[location.latitude, location.longitude]} radius={10} pathOptions={{ color: "#111827" }}>
          <Popup>Your live location</Popup>
        </CircleMarker>
      ) : null}

      {responders.map((responder) => (
        <CircleMarker
          key={`responder-${responder.id}`}
          center={[responder.latitude, responder.longitude]}
          radius={8}
          pathOptions={{ color: responderColor(responder.responderType) }}
        >
          <Popup>
            <strong>{responder.name}</strong>
            <br />
            Type: {responder.responderType}
            <br />
            Distance: {responder.distanceKm} km
          </Popup>
        </CircleMarker>
      ))}

      {incidents.slice(0, 10).map((incident) => (
        <CircleMarker
          key={`incident-${incident.id}`}
          center={[incident.latitude, incident.longitude]}
          radius={7}
          pathOptions={{ color: "#f97316" }}
        >
          <Popup>
            <strong>{incident.incidentType.toUpperCase()}</strong>
            <br />
            {incident.description}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
