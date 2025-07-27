import {
	type FieldType,
	type IExecuteFunctions,
	ILoadOptionsFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
import type { AnyDefinition, PackageDefinition, ServiceDefinition } from '@grpc/proto-loader';
import { Enum, Field, MapField, parse as protoParse, Root, Type } from 'protobufjs';
import { ServiceClient } from '@grpc/grpc-js/build/src/make-client';
import { Metadata, type ChannelCredentials } from '@grpc/grpc-js';

// Insomnia uses this logic to distinguish Services from messages&enums inside packages
// https://github.com/Kong/insomnia/blob/3bcf4f7f3277a5dacce237b97c49425873174f11/packages/insomnia/src/main/ipc/grpc.ts#L320-L338
function isService(def: AnyDefinition): def is ServiceDefinition {
	return !['Protocol Buffer 3 DescriptorProto', 'Protocol Buffer 3 EnumDescriptorProto'].includes(
		def.format as string,
	);
}

export function servicesFromProto(protoText: string): string[] {
	const pkgDef = protoStringToPackage(protoText);
	return Object.entries(pkgDef)
		.filter(([_, v]) => isService(v))
		.map(([k, _]) => k);
}

export function methodsInService(protoText: string, serviceName: string): string[] {
	const pkgDef = protoStringToPackage(protoText);
	return Object.keys(pkgDef[serviceName]);
}

export function protoStringToRoot(protoText: string): Root {
	return protoParse(protoText).root;
}

export function protoStringToPackage(protoText: string): PackageDefinition {
	return protoLoader.fromJSON(protoStringToRoot(protoText).toJSON());
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

export function jsonToProtobufFields(
	root: Root,
	service: string,
	method: string,
	data: any,
): Uint8Array {
	const reqType = root.lookupService(service).methods[method].requestType;
	const type = root.lookupType(reqType);

	return type.encode(data).finish();
}

export async function sendMessageToServer(
	location: string,
	service: string,
	method: string,
	pkg: PackageDefinition,
	message: any,
	headers: [{ name: string; value: string }],
	credentials: ChannelCredentials = grpc.credentials.createInsecure(),
): Promise<any[]> {
	// e.g. grpcbin.GRPCBin, last period separates package from service
	const separator = service.lastIndexOf('.');
	const packageName = service.substring(0, separator);
	const serviceName = service.substring(separator + 1);
	const clientDef = grpc.loadPackageDefinition(pkg)[packageName];
	const client: ServiceClient = new clientDef[serviceName](location, credentials);

	return new Promise<any[]>((resolve, reject) => {
		const args: any[] = [];
		if (!(pkg[service] as ServiceDefinition)[method].requestStream) {
			// unary request, data is passed as function argument
			args.push(message);
		}
		if (headers.length > 0) {
			const metadata = new Metadata();
			headers.forEach((h) => metadata.add(h.name, h.value));
			args.push(metadata);
		}
		if (!(pkg[service] as ServiceDefinition)[method].responseStream) {
			// unary response, handled via callback on the method call
			// this is the exit point for unary-response RPCs
			args.push((err: any, resp: any) => {
				if (err) reject(err);
				else resolve([resp]);
			});
		}

		// four possible options:
		// (x) => y									 	client[method](x, (err, resp) => resolve(resp))
		// (x) => stream<y> 				 	client[method](x); call.on(data, resolve(data))
		// (stream<x>) => y					 	client.method((err, resp) => resolve(resp)); call.write(x); call.end()
		// (stream<x>) => stream<y>	 	client[method](); call.write(x); call.end(); call.on(data, resolve(data))
		// if headers exist, they are passed between the data and the callback
		const call = client[method](...args);

		if ((pkg[service] as ServiceDefinition)[method].requestStream) {
			// request is stream, each must be passed via call.write
			call.write(message);
			call.end();
		}
		if ((pkg[service] as ServiceDefinition)[method].responseStream) {
			// response is stream, it pushes responses via .on(data)
			// this is the exit point for multi-response RPCs
			const outputMessages: any[] = [];
			call.on('data', (d: any) => outputMessages.push(d));
			call.on('end', () => resolve(outputMessages));
			call.on('error', reject);
		}
	});
}

function isExecuteFunctions(x: IExecuteFunctions | ILoadOptionsFunctions): x is IExecuteFunctions {
	return 'executeWorkflow' in x;
}

export async function makeGrpcCredFromNode(
	this: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<ChannelCredentials> {
	// return grpc.credentials.createInsecure();
	const getParamOfFirst = (param: string, defaultValue?: any): any => {
		if (isExecuteFunctions(this)) {
			return this.getNodeParameter(param, 0, defaultValue);
		} else {
			return this.getNodeParameter(param, defaultValue);
		}
	};
	const tls = getParamOfFirst('options.tls.tls', {
		enableTls: true,
		ignoreIssues: false,
	}) as {
		enableTls: boolean;
		ignoreIssues: boolean;
	};
	let channelCredentials: ChannelCredentials;
	if (tls.enableTls) {
		channelCredentials = grpc.credentials.createSsl(
			null, // rootCerts, privateKey, certChain
			null,
			null,
			{
				rejectUnauthorized: !tls.ignoreIssues,
			},
		);
	} else {
		channelCredentials = grpc.credentials.createInsecure();
	}

	/*const authType = getParamOfFirst('authentication', 'none') as
		| 'none'
		| 'predefinedCredentialType'
		| 'genericCredentialType';
	let callCredentialCallback: CallMetadataGenerator | undefined;
	switch (authType) {
		case 'none':
			callCredentialCallback = undefined;
			break;
		case 'predefinedCredentialType':
			const credType = getParamOfFirst('nodeCredentialType') as string;
			const cred = await this.getCredentials(credType);
			console.log('CRED', credType, cred);
			callCredentialCallback = (
				_params: any,
				callback: (e: Error | null, metadata: Metadata) => void,
			) => {
				const meta = new grpc.Metadata();
				meta.add('custom-auth-header', 'token');
				callback(null, meta);
			};
			break;
		case 'genericCredentialType':
			callCredentialCallback = (
				_params: any,
				callback: (e: Error | null, metadata: Metadata) => void,
			) => {
				const meta = new grpc.Metadata();
				meta.add('custom-auth-header', 'token');
				callback(null, meta);
			};
			break;
	}

	const callCredentials = callCredentialCallback
		? grpc.credentials.createFromMetadataGenerator(callCredentialCallback)
		: undefined;

	return grpc.credentials.combineChannelCredentials(
		channelCredentials,
		...(callCredentials ? [callCredentials] : []),
	);*/
	return channelCredentials;
}
