"""Conservative projection: observation does not prove wear or availability."""


def projection_decision(last_seen, confidence, location_id, observation):
    if last_seen is None:
        return "replace"
    if observation.observed_at < last_seen:
        return "retain"
    if observation.observed_at == last_seen:
        return "conflict" if observation.location_id != location_id else "retain"
    if confidence is not None and observation.confidence < float(confidence):
        return "retain"
    return "replace"
