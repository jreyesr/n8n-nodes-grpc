import { type FieldType, type INodePropertyOptions } from 'n8n-workflow';

const protoLoader = require('@grpc/proto-loader');
import type { AnyDefinition, PackageDefinition, ServiceDefinition } from '@grpc/proto-loader';
import { Enum, Field, MapField, parse as protoParse, Root, Type } from 'protobufjs';

// Insomnia uses this logic to distinguish Services from messages&enums inside packages
// https://github.com/Kong/insomnia/blob/3bcf4f7f3277a5dacce237b97c49425873174f11/packages/insomnia/src/main/ipc/grpc.ts#L320-L338
function isService(def: AnyDefinition): def is ServiceDefinition {
	return !['Protocol Buffer 3 DescriptorProto', 'Protocol Buffer 3 EnumDescriptorProto'].includes(
		def.format as string,
	);
}

export function servicesFromProto(protoText: string): string[] {
	const pkgDef: PackageDefinition = protoLoader.fromJSON(protoStringToRoot(protoText).toJSON());
	return Object.entries(pkgDef)
		.filter(([_, v]) => isService(v))
		.map(([k, _]) => k);
}

export function methodsInService(protoText: string, serviceName: string): string[] {
	const pkgDef: PackageDefinition = protoLoader.fromJSON(protoStringToRoot(protoText).toJSON());
	return Object.values(pkgDef).filter(isService).flatMap(Object.keys);
}

export function protoStringToRoot(protoText: string): Root {
	return protoParse(protoText).root;
}

export function fieldsForMethod(root: Root, service: string, method: string): Field[] {
	const reqType = root.lookupService(service).methods[method].requestType;
	const type = root.lookupType(reqType);

	return type.fieldsArray;
}

// rough outline comes from https://github.com/bloomrpc/bloomrpc-mock/blob/master/src/automock.ts
export function protobufFieldToN8NMapperType(f: Field): FieldType {
	f = f.resolve();

	switch (true) {
		case f.repeated: // whatever, but repeated
			return 'array';
		case f instanceof MapField: // Record<K, V>
			return 'object';
		case f.resolvedType instanceof Type: // nested type
			return 'object';
		case f.resolvedType instanceof Enum: // X=0 | Y=1 | Z=2
			return 'options';
		default:
			switch (f.type) {
				case 'string':
				case 'bytes':
					return 'string';
				case 'number':
				case 'int32':
				case 'int64':
				case 'uint32':
				case 'uint64':
				case 'sint32':
				case 'sint64':
				case 'fixed32':
				case 'fixed64':
				case 'sfixed32':
				case 'sfixed64':
				case 'double':
				case 'float':
					return 'number';
				case 'bool':
					return 'boolean';
				default:
					return 'string';
			}
	}
}

export function protobufFieldToN8NOptions(f: Field): INodePropertyOptions[] | undefined {
	f = f.resolve();
	if (!(f.resolvedType instanceof Enum)) return undefined;

	return Object.entries(f.resolvedType.values).map(([name, value]) => ({ name, value }));
}

