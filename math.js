class Vector3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    toArray() {
        return [this.x, this.y, this.z];
    }

    magnitude() {
        return Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2) + Math.pow(this.z, 2));
    }

    normalize() {
        const mag = this.magnitude();
        return new Vector3(this.x / mag, this.y / mag, this.z / mag);
    }

    dot(other) {
        return this.x * other.x + this.y * other.y + this.z * other.z;
    }

    cross(other) {
        return new Vector3(
            this.y * other.z - this.z * other.y,
            this.z * other.x - this.x * other.z,
            this.x * other.y - this.y * other.x
        );
    }

    add(other) {
        return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
    }

    subtract(other) {
        return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
    }

    scale(n) {
        return new Vector3(this.x * n, this.y * n, this.z * n);
    }

    angleBetween(other) {
        return Math.acos(this.dot(other) / (this.magnitude() * other.magnitude()));
    }

    inverse() {
        const ret = new Vector3(1.0 / this.x, 1.0 / this.y, 1.0 / this.z);
        return new Vector3(isNaN(ret.x) ? 0 : ret.x, isNaN(ret.y) ? 0 : ret.y, isNaN(ret.z) ? 0 : ret.z);
    }

    negate() {
        return new Vector3(-this.x, -this.y, -this.z);
    }

    multiply(other) {
        return new Vector3(this.x * other.x, this.y * other.y, this.z * other.z);
    }

    abs() {
        return new Vector3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z));
    }

    dimensionsLessThan(other) {
        return this.x < other.x && this.y < other.y && this.z < other.z;
    }
}

class Ray {
    constructor(origin, direction) {
        this.origin = origin;
        this.direction = direction.normalize();
        this.m = this.direction.inverse();
    }

    closestPoint(v3) {
        const ap = v3.subtract(this.origin);
        const ab = this.direction;
        return this.origin.add(this.direction.scale(ap.dot(ab) / ab.dot(ab)));
    }

    // Get a point down the ray, t units.
    pointAlong(t) {
        return this.origin.add(this.direction.normalize().scale(t));
    }
}

module.exports = {
    Vector3,
    Ray,
    rayIntersectsPrism: function(ray, center, size, maxRayLength) {
        const ro = ray.origin.subtract(center);
        const s = new Vector3(ray.direction.x < 0 ? 1 : -1, ray.direction.y < 0 ? 1 : -1, ray.direction.z < 0 ? 1 : -1);
        const t1 = ray.m.multiply(ro.negate().add(s.multiply(size)));
        const t2 = ray.m.multiply(ro.negate().subtract(s.multiply(size)));
        const tn = Math.max(Math.max(t1.x, t1.y), t1.z);
        const tf = Math.min(Math.min(t2.x, t2.y), t2.z);
        return tn < tf && tf > 0 && tn <= maxRayLength;
    }
};